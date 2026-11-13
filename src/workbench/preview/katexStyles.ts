/**
 * KaTeX's stylesheet and fonts, loaded the first time the preview shows maths and never before.
 * Vite turns the dynamic import into a `<link>` to a bundled file (style-src 'self'), and the
 * fonts it names are bundled files too (font-src 'self'; see the plugin in vite.config.ts).
 */
let loading: Promise<void> | null = null;

export function ensureKatexStyles(): Promise<void> {
  loading ??= import("katex/dist/katex.min.css").then(
    () => undefined,
    () => {
      // Try again at the next render rather than staying unstyled for good.
      loading = null;
    },
  );
  return loading;
}

/** Whether the rendered content has any KaTeX output. */
export function hasMathOutput(root: ParentNode): boolean {
  return root.querySelector(".katex") !== null;
}
