/**
 * The languages that can be highlighted, and how to load each one.
 *
 * Every grammar is its own dynamic import, so a document pays only for the languages it uses and
 * the start-up bundle pays for none. Names are looked up through `ALIASES`, so ```` ```ts ````,
 * ```` ```typescript ```` and ```` ```TS ```` all load the same grammar.
 */
import type { LanguageFn } from "highlight.js";

type Loader = () => Promise<{ default: LanguageFn }>;

const LOADERS: Record<string, Loader> = {
  bash: () => import("highlight.js/lib/languages/bash"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  css: () => import("highlight.js/lib/languages/css"),
  diff: () => import("highlight.js/lib/languages/diff"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  go: () => import("highlight.js/lib/languages/go"),
  graphql: () => import("highlight.js/lib/languages/graphql"),
  ini: () => import("highlight.js/lib/languages/ini"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  latex: () => import("highlight.js/lib/languages/latex"),
  less: () => import("highlight.js/lib/languages/less"),
  lua: () => import("highlight.js/lib/languages/lua"),
  makefile: () => import("highlight.js/lib/languages/makefile"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  nginx: () => import("highlight.js/lib/languages/nginx"),
  perl: () => import("highlight.js/lib/languages/perl"),
  php: () => import("highlight.js/lib/languages/php"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
  python: () => import("highlight.js/lib/languages/python"),
  r: () => import("highlight.js/lib/languages/r"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  rust: () => import("highlight.js/lib/languages/rust"),
  scss: () => import("highlight.js/lib/languages/scss"),
  shell: () => import("highlight.js/lib/languages/shell"),
  sql: () => import("highlight.js/lib/languages/sql"),
  swift: () => import("highlight.js/lib/languages/swift"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
};

const ALIASES: Record<string, string> = {
  sh: "bash",
  zsh: "bash",
  "c++": "cpp",
  h: "c",
  hpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  "c#": "csharp",
  patch: "diff",
  docker: "dockerfile",
  gql: "graphql",
  toml: "ini",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsonc: "json",
  json5: "json",
  kt: "kotlin",
  tex: "latex",
  make: "makefile",
  md: "markdown",
  pl: "perl",
  ps1: "powershell",
  pwsh: "powershell",
  py: "python",
  python3: "python",
  rb: "ruby",
  rs: "rust",
  console: "shell",
  shellsession: "shell",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  html: "xml",
  xhtml: "xml",
  svg: "xml",
  xaml: "xml",
  csproj: "xml",
  yml: "yaml",
};

/** The canonical grammar name for a fence language, or undefined if there is no grammar. */
export function canonicalLanguage(name: string): string | undefined {
  const key = name.toLowerCase();
  const canonical = ALIASES[key] ?? key;
  return Object.prototype.hasOwnProperty.call(LOADERS, canonical) ? canonical : undefined;
}

export async function loadLanguage(canonical: string): Promise<LanguageFn | undefined> {
  const loader = Object.prototype.hasOwnProperty.call(LOADERS, canonical)
    ? LOADERS[canonical]
    : undefined;
  return loader ? (await loader()).default : undefined;
}

export const SUPPORTED_LANGUAGES: readonly string[] = Object.keys(LOADERS);
