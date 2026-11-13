/**
 * The seam between the app and a document format.
 *
 * The workbench knows nothing about Markdown. It asks the registry for the provider that
 * matches a file and uses only what is declared here. Adding a format means adding a folder
 * under `src/formats/` that exports one of these.
 */
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** How the editor presents the buffer. Providers declare which modes they support. */
export type ViewMode = "source" | "live" | "split";

/**
 * `text` providers edit a plain text buffer in CodeMirror. The discriminator exists so a later
 * `structured` kind (for example DOCX in a different editor) can be added without touching
 * existing providers.
 */
export type FormatProvider = TextFormatProvider;

export interface TextFormatProvider {
  readonly kind: "text";
  /** Stable id, for example `markdown`. Used in settings and persisted state. */
  readonly id: string;
  /** Shown in the UI, for example `Markdown`. */
  readonly name: string;
  /** Lower-case extensions without the dot. The first is the default for new files. */
  readonly fileExtensions: readonly string[];
  /** View modes this format supports. Must include `source`. */
  readonly viewModes: readonly ViewMode[];

  /** CodeMirror extensions for this format in the given mode (language, keymaps, decorations). */
  editorExtensions(context: EditorContext): Extension[];

  /** Render the text for the preview pane. Omit if the format has no preview. */
  render?(text: string, context: RenderContext): Promise<RenderResult>;

  /**
   * Headings or equivalent structure for the outline panel, read from the editor's own state
   * (its syntax tree) rather than by re-parsing the text. Synchronous and cheap: it must never
   * block on a slow parse, so with an unfinished tree it returns what the tree has so far.
   */
  outline?(state: EditorState): OutlineItem[];

  /** Commands contributed by the format (bold, insert table and so on). */
  readonly commands?: readonly FormatCommand[];

  /** Export targets (HTML, PDF and so on). */
  readonly exporters?: readonly Exporter[];
}

export interface EditorContext {
  mode: ViewMode;
  /** Absolute path of the document, or null if it has never been saved. */
  path: string | null;
  /** Read a setting by key, with the provider's own default. */
  setting<T>(key: string, fallback: T): T;
}

export interface RenderContext {
  /** Absolute path of the document, used to resolve relative links and images. */
  path: string | null;
  /** Turns a path relative to the document into a URL the webview can load. */
  resolveAsset(relativePath: string): string;
  /** Aborted when a newer render supersedes this one. */
  signal?: AbortSignal;
}

export interface RenderResult {
  /**
   * Sanitised HTML. Block elements carry `data-line="<n>"` (1-based source line of the block
   * start) so the preview can sync scroll position with the editor.
   */
  html: string;
}

export interface OutlineItem {
  /** 1 to 6. */
  level: number;
  text: string;
  /** 1-based line in the source. */
  line: number;
  /** Document offset of the start of the heading. */
  from: number;
}

export interface FormatCommand {
  /** Namespaced id, for example `markdown.toggleBold`. */
  id: string;
  title: string;
  /** CodeMirror key notation, for example `Mod-b`. */
  defaultKey?: string;
  /** Returns true if the command applied. */
  run(view: EditorView): boolean;
}

export interface Exporter {
  /** For example `html`. */
  id: string;
  /** For example `HTML`. */
  name: string;
  /** Extension of the exported file without the dot. */
  fileExtension: string;
  export(text: string, context: RenderContext): Promise<Uint8Array>;
}
