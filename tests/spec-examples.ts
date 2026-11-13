/** Helpers shared by the conformance tests: spec parsing and HTML normalisation. */

export interface SpecExample {
  /** 1-based, in file order, counting every example (as the spec's own numbering does). */
  number: number;
  section: string;
  /** The tag after `example` in the fence, for example `table`, or "" for core examples. */
  tag: string;
  markdown: string;
  html: string;
}

const FENCE_OPEN = /^`{32} example ?(.*)$/;
const FENCE_CLOSE = /^`{32}$/;

/** Parse the examples out of a CommonMark-style `spec.txt`. `→` marks a tab, as in the spec. */
export function parseSpec(source: string): SpecExample[] {
  const examples: SpecExample[] = [];
  let section = "";
  let state: "text" | "markdown" | "html" = "text";
  let tag = "";
  let markdown: string[] = [];
  let html: string[] = [];
  for (const line of source.split("\n")) {
    if (state === "text") {
      const open = FENCE_OPEN.exec(line);
      if (open) {
        state = "markdown";
        tag = (open[1] ?? "").trim();
        markdown = [];
        html = [];
      } else {
        const heading = /^#{1,6} +(.*)$/.exec(line);
        if (heading) section = heading[1] ?? "";
      }
    } else if (state === "markdown") {
      if (line === ".") state = "html";
      else markdown.push(line);
    } else if (FENCE_CLOSE.test(line)) {
      examples.push({
        number: examples.length + 1,
        section,
        tag,
        markdown: markdown.length ? markdown.join("\n").replace(/→/g, "\t") + "\n" : "",
        html: html.length ? html.join("\n").replace(/→/g, "\t") + "\n" : "",
      });
      state = "text";
    } else {
      html.push(line);
    }
  }
  return examples;
}

const BLOCK_TAGS =
  "address|article|aside|blockquote|body|br|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const BLOCK_BOUNDARY = new RegExp(`\\s*(</?(?:${BLOCK_TAGS})(?:\\s[^>]*)?/?>)\\s*`, "gi");

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}

const decoder = document.createElement("textarea");
function decode(text: string): string {
  decoder.innerHTML = text;
  return decoder.value;
}

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const TOKEN =
  /<!--[\s\S]*?-->|<\/?[a-zA-Z][^\s>/]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|[^<]+|</g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * Normalise HTML for comparison, in the spirit of the spec's own `normalize.py`. It tokenises
 * and does not repair the tree (the spec's expected output contains unbalanced tags, and a
 * browser parser would "fix" them and hide real differences). Attribute order, quoting, entity
 * style and void-tag style do not matter; whitespace runs outside `<pre>` collapse and
 * whitespace around block-level tags is ignored. Text, tags and attribute values are otherwise
 * compared exactly.
 */
export function normaliseHtml(html: string): string {
  let out = "";
  let preDepth = 0;
  const pres: string[] = [];
  let currentPre = "";
  const emit = (piece: string) => {
    if (preDepth > 0) currentPre += piece;
    else out += piece;
  };
  for (const [token] of html.matchAll(TOKEN)) {
    if (token.startsWith("<!--")) {
      emit(token);
    } else if (token.length > 1 && token.startsWith("<") && /^<\/?[a-zA-Z]/.test(token)) {
      const closing = token.startsWith("</");
      const body = token.replace(/^<\/?/, "").replace(/\/?>$/, "");
      const name = /^[^\s>/]+/.exec(body)?.[0]?.toLowerCase() ?? "";
      if (closing) {
        emit(`</${name}>`);
        if (name === "pre" && preDepth > 0 && --preDepth === 0) {
          pres.push(currentPre);
          out += `\uE000${pres.length - 1}\uE000`;
          currentPre = "";
        }
      } else {
        const attributes: [string, string][] = [];
        for (const m of body.slice(name.length).matchAll(ATTRIBUTE)) {
          attributes.push([(m[1] ?? "").toLowerCase(), decode(m[2] ?? m[3] ?? m[4] ?? "")]);
        }
        attributes.sort((a, b) => a[0].localeCompare(b[0]));
        const rendered = attributes.map(([n, v]) => ` ${n}="${escapeAttribute(v)}"`).join("");
        if (name === "pre") preDepth++;
        emit(VOID.has(name) ? `<${name}${rendered} />` : `<${name}${rendered}>`);
      }
    } else {
      const text = decode(token);
      emit(escapeText(preDepth > 0 ? text : text.replace(/\s+/g, " ")));
    }
  }
  out = out.replace(BLOCK_BOUNDARY, "$1").trim();
  return out.replace(/\uE000(\d+)\uE000/g, (_, i: string) => pres[Number(i)] ?? "");
}
