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

  /**
   * The formatting toolbar (the ribbon) for documents of this format: groups of buttons that
   * name commands by id. Labels, tooltips and shortcuts come from the command registry, so
   * nothing is repeated here. Omit for a format with no toolbar.
   */
  readonly toolbar?: readonly ToolbarGroup[];

  /** Export targets (HTML, PDF and so on). */
  readonly exporters?: readonly Exporter[];

  /**
   * How a document of this format shows an image. `path` is relative to the document, POSIX-style
   * (`./assets/a.png`), unescaped; the provider applies whatever escaping its syntax needs.
   * Declaring this is what lets the workbench paste, drop and insert images into the format.
   */
  imageSyntax?(path: string, alt: string): string;
  /** How a document of this format links to another file. Same `path` rules as `imageSyntax`. */
  linkSyntax?(path: string, text: string): string;
}

export interface EditorContext {
  mode: ViewMode;
  /** Absolute path of the document, or null if it has never been saved. */
  path: string | null;
  /** Read a setting by key, with the provider's own default. */
  setting<T>(key: string, fallback: T): T;
  /** Follows a link target written in the document (URL or relative path). Optional. */
  openLink?(href: string): void;
  /** URL the webview can load for an image path relative to the document; "" if none. */
  resolveAsset?(relativePath: string): string;
}

export interface RenderContext {
  /** Absolute path of the document, used to resolve relative links and images. */
  path: string | null;
  /** Turns a path relative to the document into a URL the webview can load. */
  resolveAsset(relativePath: string): string;
  /** Aborted when a newer render supersedes this one. */
  signal?: AbortSignal;
  /**
   * Values of the settings the renderer reads (for example `markdown.math`), by key. Plain data,
   * so it can cross to a worker. A key that is absent means "use the default".
   */
  settings?: Readonly<Record<string, boolean | number | string>>;
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
  /**
   * Whether the command applies at the current selection. When it returns false the command is
   * disabled: menus grey it out and its key is not intercepted, so the key falls through to the
   * editor's own keymap or the browser. Omit for a command that is always available while a
   * document of the format is open.
   */
  enabled?(state: EditorState): boolean;
  /**
   * Whether the formatting this command applies is already present at the selection (the cursor
   * is in bold text, the lines are a bulleted list and so on). Drives the pressed state of a
   * toolbar button. Must be cheap: it runs after every selection change. Omit if the idea does
   * not apply to the command.
   */
  active?(state: EditorState): boolean;
  /** Returns true if the command applied. */
  run(view: EditorView): boolean;
}

/** A labelled run of toolbar items. The toolbar draws a divider between groups. */
export interface ToolbarGroup {
  /** Stable id, for example `text`. */
  id: string;
  /** Accessible name of the group, for example `Text`. Not drawn as visible text. */
  label: string;
  /**
   * Whether the group shows at the current selection (a table group while the cursor is in a
   * table). Omit for a group that is always shown. Put such groups last so that they appear
   * without moving the others.
   */
  visible?(state: EditorState): boolean;
  items: readonly ToolbarItem[];
}

export type ToolbarItem = ToolbarButton | ToolbarSelect;

/** An icon button that runs a registered command. */
export interface ToolbarButton {
  /** Id of a registered command. The button is left out if the command is not registered. */
  command: string;
  /**
   * SVG path data (the `d` attribute) drawn in a 16 by 16 box, stroked with the current text
   * colour. Supplied by the provider so the workbench has no format-specific icons.
   */
  icon: string;
}

/** A compact drop-down that shows which option applies and runs the command of the one chosen. */
export interface ToolbarSelect {
  /** Accessible name of the control, for example `Block type`. */
  label: string;
  options: readonly ToolbarOption[];
}

export interface ToolbarOption {
  /** Id of a registered command. */
  command: string;
  /** Text shown for the option, for example `Heading 1`. */
  label: string;
  /** Whether this option describes the selection. The first that does is shown on the control. */
  active?(state: EditorState): boolean;
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
