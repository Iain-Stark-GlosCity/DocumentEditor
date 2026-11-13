/**
 * Draws Mermaid diagrams in the preview.
 *
 * The pipeline leaves `<pre class="mermaid-source" data-line="n">` holding the escaped source
 * (it runs in a worker, and Mermaid needs the DOM). After the sanitised HTML is in the page,
 * `DiagramRenderer.process` finds those placeholders, imports Mermaid (only now, and only if
 * there is one), renders each source to SVG and swaps the placeholder for a wrapper that keeps
 * the `data-line` mark.
 *
 * Safety: Mermaid runs with `securityLevel: "strict"` (it sanitises labels and refuses click
 * handlers) and `startOnLoad: false`; the SVG it returns is sanitised again with DOMPurify, the
 * same configuration Mermaid itself uses, before it is put in the page. A diagram that fails
 * shows the message and its source instead.
 *
 * Block-diff cooperation: the wrapper records a hash of its source, so `isSameDiagram` can tell
 * the block updater that an unchanged diagram needs no rebuild. Finished SVG is also cached by
 * theme and source hash, so a diagram that does have to be re-inserted (it moved, or came back
 * after an undo) appears at once with no flicker.
 */

export const PLACEHOLDER_SELECTOR = "pre.mermaid-source";
export const DIAGRAM_CLASS = "mermaid-diagram";
const HASH_ATTRIBUTE = "data-mermaid-hash";
const THEME_ATTRIBUTE = "data-mermaid-theme";

export type DiagramTheme = "light" | "dark";

/** The part of Mermaid this module uses. */
export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

export interface DiagramOptions {
  /** Loads Mermaid. Default: a dynamic import, so it is fetched when first needed. */
  load?: () => Promise<MermaidApi>;
  /** Cleans Mermaid's SVG. Default: DOMPurify (also loaded lazily). */
  sanitise?: (svg: string) => Promise<string> | string;
  /** How many finished diagrams to remember. */
  cacheSize?: number;
}

/** A small, fast, non-cryptographic hash (cyrb53) of the source text. */
export function hashSource(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length.toString(36)}-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** A finished diagram: either SVG or the message of the error that stopped it. */
type Outcome = { ok: true; svg: string } | { ok: false; message: string };

async function defaultLoad(): Promise<MermaidApi> {
  return (await import("mermaid")).default as unknown as MermaidApi;
}

/** Mermaid's own DOMPurify settings, plus a ban on scripts. */
async function defaultSanitise(svg: string): Promise<string> {
  const purify = (await import("dompurify")).default;
  return purify.sanitize(svg, {
    ADD_TAGS: ["foreignobject"],
    ADD_ATTR: ["dominant-baseline"],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS: ["script"],
  });
}

/** Whether `live` (a rendered diagram) still stands for `fresh` (a placeholder). */
export function isSameDiagram(live: Element, fresh: Element): boolean {
  return (
    live.classList.contains(DIAGRAM_CLASS) &&
    fresh.matches(PLACEHOLDER_SELECTOR) &&
    live.getAttribute(HASH_ATTRIBUTE) === hashSource(fresh.textContent ?? "")
  );
}

export class DiagramRenderer {
  private readonly load: () => Promise<MermaidApi>;
  private readonly sanitise: (svg: string) => Promise<string> | string;
  private readonly cacheSize: number;
  private readonly cache = new Map<string, Outcome>();
  /** Placeholders and wrappers whose render is queued or running. */
  private readonly busy = new WeakSet<Element>();
  /** The source of each wrapper, for drawing it again when the theme changes. */
  private readonly sources = new WeakMap<Element, string>();
  private mermaid: Promise<MermaidApi> | null = null;
  private configuredFor: DiagramTheme | null = null;
  private queue: Promise<void> = Promise.resolve();
  /** The newest request, so a render that finishes for an older theme can be redone. */
  private wanted: { root: ParentNode; theme: DiagramTheme } | null = null;
  private counter = 0;

  constructor(options: DiagramOptions = {}) {
    this.load = options.load ?? defaultLoad;
    this.sanitise = options.sanitise ?? defaultSanitise;
    this.cacheSize = options.cacheSize ?? 64;
  }

  /**
   * Draws every placeholder under `root`, and redraws diagrams drawn for another theme.
   * Resolves when everything that was started has finished. Cached diagrams are put in
   * synchronously, before this returns its promise.
   */
  process(root: ParentNode, theme: DiagramTheme): Promise<void> {
    this.wanted = { root, theme };
    const jobs: Promise<void>[] = [];
    for (const placeholder of Array.from(root.querySelectorAll(PLACEHOLDER_SELECTOR))) {
      if (this.busy.has(placeholder)) continue;
      const source = placeholder.textContent ?? "";
      const cached = this.remembered(theme, source);
      if (cached) {
        this.show(placeholder, source, theme, cached);
        continue;
      }
      this.busy.add(placeholder);
      jobs.push(this.enqueue(placeholder, source, theme));
    }
    for (const diagram of Array.from(root.querySelectorAll(`.${DIAGRAM_CLASS}`))) {
      const source = this.sources.get(diagram);
      if (source === undefined || diagram.getAttribute(THEME_ATTRIBUTE) === theme) continue;
      if (this.busy.has(diagram)) continue;
      const cached = this.remembered(theme, source);
      if (cached) {
        this.show(diagram, source, theme, cached);
        continue;
      }
      this.busy.add(diagram);
      jobs.push(this.enqueue(diagram, source, theme));
    }
    return Promise.all(jobs).then(() => undefined);
  }

  private key(theme: DiagramTheme, source: string): string {
    return `${theme}:${hashSource(source)}`;
  }

  private remembered(theme: DiagramTheme, source: string): Outcome | undefined {
    const key = this.key(theme, source);
    const found = this.cache.get(key);
    if (found) {
      // Most recently used goes last.
      this.cache.delete(key);
      this.cache.set(key, found);
    }
    return found;
  }

  private remember(theme: DiagramTheme, source: string, outcome: Outcome): void {
    this.cache.set(this.key(theme, source), outcome);
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private enqueue(target: Element, source: string, theme: DiagramTheme): Promise<void> {
    const run = async () => {
      try {
        if (!target.isConnected) return;
        // Something else may have drawn the same source while this waited.
        const outcome = this.remembered(theme, source) ?? (await this.draw(source, theme));
        if (!target.isConnected) return;
        // The block may have been edited meanwhile: only draw if it still holds this source.
        if (target.matches(PLACEHOLDER_SELECTOR) && target.textContent !== source) return;
        this.show(target, source, theme, outcome);
      } finally {
        this.busy.delete(target);
      }
    };
    // One at a time: Mermaid keeps global state while it renders.
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next.then(() => {
      // The theme changed while this was drawing: draw it again for the new one.
      const wanted = this.wanted;
      if (wanted && wanted.theme !== theme) {
        return this.process(wanted.root, wanted.theme);
      }
    });
  }

  private async draw(source: string, theme: DiagramTheme): Promise<Outcome> {
    const id = `mermaid-${++this.counter}`;
    let mermaid: MermaidApi;
    try {
      this.mermaid ??= this.load();
      mermaid = await this.mermaid;
    } catch (error) {
      // A failed load is not remembered, so a later render can try again.
      this.mermaid = null;
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    try {
      if (this.configuredFor !== theme) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "default",
        });
        this.configuredFor = theme;
      }
      const { svg } = await mermaid.render(id, source);
      const outcome: Outcome = { ok: true, svg: await this.sanitise(svg) };
      this.remember(theme, source, outcome);
      return outcome;
    } catch (error) {
      const outcome: Outcome = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
      this.remember(theme, source, outcome);
      return outcome;
    } finally {
      // Mermaid leaves its scratch element in `body` when a render fails.
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
    }
  }

  /** Puts the outcome in the page, in place of `target` (a placeholder) or inside it (a wrapper). */
  private show(target: Element, source: string, theme: DiagramTheme, outcome: Outcome): void {
    const wrapper = target.classList.contains(DIAGRAM_CLASS)
      ? target
      : target.ownerDocument.createElement("div");
    if (wrapper === target) wrapper.replaceChildren();
    wrapper.className = DIAGRAM_CLASS;
    const line = target.getAttribute("data-line");
    if (line !== null) wrapper.setAttribute("data-line", line);
    wrapper.setAttribute(HASH_ATTRIBUTE, hashSource(source));
    wrapper.setAttribute(THEME_ATTRIBUTE, theme);
    wrapper.setAttribute("role", "figure");
    wrapper.setAttribute("aria-label", outcome.ok ? "Diagram" : "Diagram that could not be drawn");
    if (outcome.ok) {
      // `outcome.svg` is Mermaid's output after DOMPurify (see `defaultSanitise`).
      wrapper.innerHTML = outcome.svg;
    } else {
      wrapper.classList.add("mermaid-error");
      const message = wrapper.ownerDocument.createElement("p");
      message.className = "mermaid-error-message";
      message.textContent = `This diagram could not be drawn: ${outcome.message}`;
      const pre = wrapper.ownerDocument.createElement("pre");
      const code = wrapper.ownerDocument.createElement("code");
      code.textContent = source;
      pre.append(code);
      wrapper.append(message, pre);
    }
    this.sources.set(wrapper, source);
    if (wrapper !== target) target.replaceWith(wrapper);
  }
}

/** The theme the page is showing: `data-theme` on the root (set by the theme feature), else the OS. */
export function currentTheme(): DiagramTheme {
  const set = document.documentElement.dataset["theme"];
  if (set === "dark" || set === "light") return set;
  const dark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return dark ? "dark" : "light";
}
