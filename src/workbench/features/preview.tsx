/**
 * Split view: a live rendered preview beside the editor.
 *
 * The pane shows when `editor.viewMode` is "split" and the active document's format can render
 * and supports split. Rendering happens in a worker (see `preview/`), the DOM is patched block
 * by block, and the two panes scroll together using the `data-line` marks in the HTML.
 */
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useStore } from "zustand";
import type { FormatProvider } from "../../core/format";
import type { Feature, FeatureComponentProps } from "../feature";
import { useActiveDocument, useSetting } from "../hooks";
import { updateBlocks } from "../preview/blockDiff";
import { addCopyButtons, codeText, copyToClipboard } from "../preview/codeCopy";
import { ensureKatexStyles, hasMathOutput } from "../preview/katexStyles";
import { classifyLink } from "../preview/links";
import { currentTheme, DiagramRenderer, isSameDiagram } from "../preview/mermaid";
import { prepareFragment } from "../preview/prepare";
import { PreviewModel } from "../preview/previewModel";
import { PreviewScrollSync } from "../preview/scrollSync";

/** Whether a format can show a preview in split view. */
function canSplit(provider: FormatProvider | undefined): boolean {
  return !!provider?.render && provider.viewModes.includes("split");
}

/** The editor font size is 14 by default; the preview reads comfortably at 16. */
const PREVIEW_SCALE = 8 / 7;

function findAnchor(content: HTMLElement, id: string): HTMLElement | null {
  // The sanitiser prefixes ids so author HTML cannot clobber page globals; links may omit it.
  const wanted = new Set([id, `user-content-${id}`]);
  for (const element of Array.from(content.querySelectorAll<HTMLElement>("[id]"))) {
    if (wanted.has(element.id)) return element;
  }
  return null;
}

function PreviewPane({ workbench }: FeatureComponentProps) {
  const [model] = useState(() => new PreviewModel(workbench));
  const html = useStore(model.state, (s) => s.html);
  const version = useStore(model.state, (s) => s.version);
  const slow = useStore(model.state, (s) => s.slow);
  const error = useStore(model.state, (s) => s.error);
  const fontSize = useSetting(workbench, "editor.fontSize");
  const loadRemoteImages = useSetting(workbench, "preview.loadRemoteImages");
  const mermaidOn = useSetting(workbench, "markdown.mermaid");
  const [diagrams] = useState(() => new DiagramRenderer());
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef<PreviewScrollSync | null>(null);

  useEffect(() => model.start(), [model]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const sync = new PreviewScrollSync(workbench, scroller, content, () =>
      workbench.settings.get("preview.syncScroll"),
    );
    syncRef.current = sync;
    const stop = sync.start();
    return () => {
      stop();
      syncRef.current = null;
    };
  }, [workbench]);

  // Patch the rendered blocks. `html` is only ever the sanitised output of a provider.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    if (html === null) {
      content.replaceChildren();
      return;
    }
    const fragment = prepareFragment(html, {
      assetUrl: (path) => workbench.platform.assetUrl(path),
      loadRemoteImages,
    });
    // A drawn diagram stands for its placeholder while the source is unchanged, so an edit
    // elsewhere does not rebuild it.
    updateBlocks(content, fragment, { equivalent: isSameDiagram });
    // What the main thread adds once the sanitised HTML is in: copy buttons, KaTeX's stylesheet
    // (first time maths appears) and diagrams (Mermaid is imported only if there is one).
    addCopyButtons(content);
    if (hasMathOutput(content)) void ensureKatexStyles();
    if (mermaidOn) void diagrams.process(content, currentTheme()).then(() => undefined);
    syncRef.current?.followEditor();
  }, [html, version, loadRemoteImages, mermaidOn, diagrams, workbench]);

  // Draw diagrams again in the other palette when the theme changes.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !mermaidOn) return;
    const redraw = () => void diagrams.process(content, currentTheme());
    const observer = new MutationObserver(redraw);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const query =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    query?.addEventListener("change", redraw);
    return () => {
      observer.disconnect();
      query?.removeEventListener("change", redraw);
    };
  }, [diagrams, mermaidOn]);

  function say(message: string) {
    setNotice(message);
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 2000);
  }

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    },
    [],
  );

  async function copyCode(button: Element) {
    const copied = await copyToClipboard(codeText(button));
    if (copied) {
      button.setAttribute("data-copied", "");
      setTimeout(() => button.removeAttribute("data-copied"), 2000);
    }
    say(copied ? "Code copied" : "Could not copy the code");
  }

  function onClick(event: MouseEvent<HTMLElement>) {
    const copyButton = (event.target as Element).closest("button.code-copy");
    if (copyButton && event.currentTarget.contains(copyButton)) {
      event.preventDefault();
      void copyCode(copyButton);
      return;
    }
    const link = (event.target as Element).closest("a");
    if (!link || !event.currentTarget.contains(link)) return;
    // Nothing in the preview may navigate the app's own webview.
    event.preventDefault();
    const action = classifyLink(
      link.getAttribute("href") ?? "",
      workbench.activeDocument()?.path ?? null,
    );
    switch (action.kind) {
      case "anchor": {
        const target = contentRef.current && findAnchor(contentRef.current, action.id);
        const scroller = scrollerRef.current;
        if (target && scroller) {
          scroller.scrollTop +=
            target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
        }
        break;
      }
      case "external":
        workbench.platform.openExternal(action.url).catch((e: unknown) => {
          workbench.notify({
            kind: "error",
            message: `Could not open ${action.url}: ${e instanceof Error ? e.message : String(e)}`,
          });
        });
        break;
      case "file":
        if (workbench.registry.forPath(action.path)) void workbench.openPaths([action.path]);
        else workbench.notify({ message: `Link target: ${action.path}` });
        break;
      case "none":
        if (action.reason) workbench.notify({ message: action.reason });
        break;
    }
  }

  function onDoubleClick(event: MouseEvent<HTMLElement>) {
    const block = (event.target as Element).closest("[data-line]");
    const view = workbench.activeView();
    if (!block || !view) return;
    const line = Number(block.getAttribute("data-line"));
    if (!Number.isInteger(line) || line < 1) return;
    const doc = view.state.doc;
    view.dispatch({
      selection: { anchor: doc.line(Math.min(line, doc.lines)).from },
      scrollIntoView: true,
    });
    view.focus();
  }

  return (
    <div
      className="preview"
      style={{ ["--preview-font-size" as string]: `${fontSize * PREVIEW_SCALE}px` }}
    >
      <div className="preview-status" role="status" aria-live="polite">
        {error ? `Preview not updated: ${error}` : slow ? "Rendering…" : notice}
      </div>
      <div
        ref={scrollerRef}
        className="preview-scroll"
        tabIndex={0}
        role="document"
        aria-label="Rendered document"
      >
        <div
          ref={contentRef}
          className="preview-content"
          onClick={onClick}
          onAuxClick={(e) => {
            if ((e.target as Element).closest("a")) e.preventDefault();
          }}
          onDoubleClick={onDoubleClick}
        />
      </div>
    </div>
  );
}

export const preview: Feature = {
  id: "preview",

  commands: (wb) => [
    {
      id: "view.toggleSplitPreview",
      title: "Toggle split preview",
      defaultKey: "Alt-p",
      run: () => {
        if (wb.settings.get("editor.viewMode") === "split") {
          wb.settings.set("editor.viewMode", "source");
          return;
        }
        const doc = wb.activeDocument();
        if (doc && !canSplit(wb.registry.byId(doc.providerId))) {
          wb.notify({ message: "This kind of document has no preview." });
          return;
        }
        wb.settings.set("editor.viewMode", "split");
      },
    },
  ],

  menuItems: [
    {
      menu: "view",
      group: "4_preview",
      command: "view.toggleSplitPreview",
      order: 1,
      label: "Split preview",
      checked: (wb) => wb.settings.get("editor.viewMode") === "split",
    },
  ],

  sidePane: {
    id: "preview",
    title: "Preview",
    defaultSize: 45,
    useVisible(wb) {
      const mode = useSetting(wb, "editor.viewMode");
      const doc = useActiveDocument(wb);
      return mode === "split" && !!doc && canSplit(wb.registry.byId(doc.providerId));
    },
    component: PreviewPane,
  },
};
