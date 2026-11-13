/**
 * Turns the maths nodes of a document into KaTeX output. Runs after the main sanitiser, so it
 * is the only place that adds markup the main schema would not allow, and it earns that by
 * putting everything KaTeX returns through a second, strict sanitiser (`katexSchema`) before it
 * joins the tree. Nothing an author writes reaches the tree except as KaTeX's own output:
 *
 * - the TeX source is only ever handed to KaTeX as a string, never parsed as HTML;
 * - KaTeX runs with `trust: false`, so `\href`, `\url`, `\includegraphics`, `\htmlClass`,
 *   `\htmlId`, `\htmlStyle` and `\htmlData` are refused (they come out as red source text);
 * - what KaTeX returns is parsed and sanitised with an allow-list of tags and attributes. No
 *   `a`, `img`, `id`, `name`, `href`, `src`, `data-*` or event handler can pass, and `style` is
 *   cut down to a short list of layout properties with plain values (no `url()`).
 *
 * KaTeX is imported only when a document actually contains maths.
 */
import type { Element, ElementContent, Nodes, Root as HastRoot } from "hast";
import { fromHtml } from "hast-util-from-html";
import { sanitize, type Schema } from "hast-util-sanitize";
import { toString } from "hast-util-to-string";

type KatexModule = typeof import("katex");

/** Longest formula we hand to KaTeX. Longer ones show their source as an error. */
export const MAX_FORMULA_LENGTH = 20_000;

const MATHML_TAGS = [
  "math",
  "semantics",
  "annotation",
  "mrow",
  "mi",
  "mn",
  "mo",
  "mtext",
  "mspace",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "msqrt",
  "mroot",
  "mover",
  "munder",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
  "mpadded",
  "mphantom",
  "mstyle",
  "menclose",
];

/** Handed to KaTeX as `errorColor`, then replaced by the `katex-error` class (see below). */
const ERROR_MARK = "#cc0001";

/** KaTeX class names are plain identifiers; its stylesheet gives them meaning. */
const CLASS_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** What KaTeX may emit. Anything else is dropped; unknown elements keep only their text. */
export const katexSchema: Schema = {
  tagNames: ["span", "svg", "path", "line", ...MATHML_TAGS],
  strip: ["script", "style"],
  attributes: {
    "*": [["className", CLASS_NAME], "style"],
    span: ["ariaHidden", "title"],
    svg: ["width", "height", "viewBox", "preserveAspectRatio"],
    path: ["d"],
    line: ["x1", "y1", "x2", "y2", "strokeWidth"],
    math: ["display"],
    annotation: ["encoding"],
    mo: ["fence", "separator", "stretchy", "lspace", "rspace", "minsize", "maxsize", "mathvariant"],
    mi: ["mathvariant"],
    mtext: ["mathvariant"],
    mfrac: ["linethickness"],
    mover: ["accent"],
    munder: ["accentunder"],
    menclose: ["notation"],
    mpadded: ["width", "height", "depth", "lspace", "voffset", "mathbackground"],
    mspace: ["width", "height", "linebreak", "mathbackground"],
    mstyle: ["displaystyle", "scriptlevel", "mathcolor", "mathsize"],
    mtable: ["columnalign", "columnlines", "columnspacing", "rowlines", "rowspacing", "width"],
    mtd: ["width"],
  },
  // No links, no images, nothing to clobber: none of these attributes are allowed above.
  protocols: {},
  clobber: [],
};

const STYLE_PROPERTIES = new Set([
  "background-color",
  "border",
  "border-bottom-width",
  "border-color",
  "border-right-style",
  "border-right-width",
  "border-style",
  "border-top-width",
  "border-width",
  "bottom",
  "color",
  "height",
  "left",
  "margin",
  "margin-left",
  "margin-right",
  "min-width",
  "padding",
  "padding-left",
  "top",
  "vertical-align",
  "width",
]);

/** Words, numbers, `#colour`, `%`, units, `rgb(...)` and spaces. No quotes, slashes or `:`. */
const PLAIN_VALUE = /^[\w\s#%.,()+-]*$/;
const FORBIDDEN_VALUE = /url|expression|image|attr|var\(|env\(|calc|@|\\/i;

/** Keeps only the safe declarations of an inline style; undefined if none are left. */
export function cleanStyle(style: string): string | undefined {
  const kept: string[] = [];
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (value === "" || !PLAIN_VALUE.test(value) || FORBIDDEN_VALUE.test(value)) continue;
    // `position: relative` is the only position KaTeX needs; anything else could cover the page.
    const allowed =
      STYLE_PROPERTIES.has(property) || (property === "position" && value === "relative");
    if (allowed) kept.push(`${property}:${value}`);
  }
  return kept.length > 0 ? `${kept.join(";")};` : undefined;
}

function walk(node: Nodes, visit: (element: Element) => void): void {
  if (node.type === "element") visit(node);
  if ("children" in node) for (const child of node.children) walk(child, visit);
}

/** Parses and sanitises KaTeX's HTML. */
export function sanitiseKatexHtml(html: string): ElementContent[] {
  const parsed = fromHtml(html, { fragment: true });
  const clean = sanitize(parsed, katexSchema) as HastRoot;
  walk(clean, (element) => {
    // KaTeX paints errors (a parse error, an unsupported command) in `errorColor`, which we set
    // to a marker. Swap the marker for a class, so the stylesheet picks a colour that suits the
    // theme and the contrast.
    let marked = false;
    if (String(element.properties["mathcolor"]).toLowerCase() === ERROR_MARK) {
      delete element.properties["mathcolor"];
      marked = true;
    }
    const style = element.properties["style"];
    if (typeof style === "string") {
      const cleaned = cleanStyle(style);
      const rest = cleaned
        ?.split(";")
        .filter((declaration) => {
          const isMark = declaration.replace(/\s/g, "").toLowerCase() === `color:${ERROR_MARK}`;
          marked ||= isMark;
          return declaration !== "" && !isMark;
        })
        .join(";");
      if (rest) element.properties["style"] = `${rest};`;
      else delete element.properties["style"];
    }
    if (marked) {
      const classes = element.properties["className"];
      const names = Array.isArray(classes) ? classes.map(String) : [];
      if (!names.includes("katex-error"))
        element.properties["className"] = [...names, "katex-error"];
    }
  });
  return clean.children as ElementContent[];
}

function errorSpan(source: string, message: string): ElementContent[] {
  return [
    {
      type: "element",
      tagName: "span",
      properties: { className: ["katex-error"], title: message },
      children: [{ type: "text", value: source }],
    },
  ];
}

/** Renders one formula to sanitised hast nodes. Never throws: errors become an error span. */
export function renderFormula(
  katex: KatexModule["default"],
  source: string,
  display: boolean,
): ElementContent[] {
  if (source.length > MAX_FORMULA_LENGTH) {
    return errorSpan(source, `Formula is longer than ${MAX_FORMULA_LENGTH} characters`);
  }
  try {
    const html = katex.renderToString(source, {
      displayMode: display,
      output: "htmlAndMathml",
      throwOnError: false,
      errorColor: ERROR_MARK,
      trust: false,
      // A preview should show what it can; unsupported-but-harmless input is not an error.
      strict: "ignore",
      maxExpand: 1000,
      maxSize: 100,
      // A fresh table per formula, so `\gdef` in one formula cannot leak into the next.
      macros: {},
    });
    return sanitiseKatexHtml(html);
  } catch (error) {
    return errorSpan(source, error instanceof Error ? error.message : String(error));
  }
}

interface MathNode {
  code: Element;
  parent: Element | HastRoot;
  /** The element to replace: the `pre` around a display formula, else the `code`. */
  target: Element;
  targetParent: Element | HastRoot;
  display: boolean;
}

function classNames(element: Element): string[] {
  const value = element.properties["className"];
  return Array.isArray(value) ? value.map(String) : [];
}

/** Finds `code.math-inline`, `code.math-display` and fenced `math` blocks. */
function findMath(tree: HastRoot): MathNode[] {
  const found: MathNode[] = [];
  const visit = (node: Element | HastRoot, parent: Element | HastRoot | null) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      const classes = child.tagName === "code" ? classNames(child) : [];
      if (classes.includes("math-inline") || classes.includes("math-display")) {
        const inPre = node.type === "element" && node.tagName === "pre" && parent !== null;
        if (inPre) {
          found.push({
            code: child,
            parent: node,
            target: node,
            targetParent: parent,
            display: true,
          });
        } else {
          found.push({
            code: child,
            parent: node,
            target: child,
            targetParent: node,
            display: classes.includes("math-display"),
          });
        }
        continue;
      }
      // A fenced block whose language is `math`.
      if (
        child.tagName === "pre" &&
        child.children.length === 1 &&
        child.children[0]?.type === "element" &&
        classNames(child.children[0]).includes("language-math")
      ) {
        found.push({
          code: child.children[0],
          parent: child,
          target: child,
          targetParent: node,
          display: true,
        });
        continue;
      }
      visit(child, node);
    }
  };
  visit(tree, null);
  return found;
}

/** Whether the tree has anything for KaTeX to do. Cheap: no import happens unless it does. */
export function hasMath(tree: HastRoot): boolean {
  return findMath(tree).length > 0;
}

/**
 * Replaces maths nodes with KaTeX output. Put it after the sanitiser. `load` is injectable so
 * tests can count imports.
 */
export function rehypeMath(options: { load?: () => Promise<KatexModule> } = {}) {
  const load = options.load ?? (() => import("katex"));
  return async (tree: HastRoot): Promise<void> => {
    const nodes = findMath(tree);
    if (nodes.length === 0) return;
    const katex = (await load()).default;
    for (const node of nodes) {
      let source = toString(node.code);
      // A fenced block's text ends with the newline before the closing fence.
      if (node.display && source.endsWith("\n")) source = source.slice(0, -1);
      const content = renderFormula(katex, source, node.display);
      const index = node.targetParent.children.indexOf(node.target);
      if (index < 0) continue;
      if (node.display) {
        const replacement: Element = {
          type: "element",
          tagName: "div",
          properties: { className: ["math-display"] },
          children: content,
        };
        // Keep the source line, so scroll sync still finds the block.
        const line = node.target.properties["dataLine"];
        if (line !== undefined) replacement.properties["dataLine"] = line;
        node.targetParent.children[index] = replacement;
      } else {
        node.targetParent.children.splice(index, 1, ...content);
      }
    }
  };
}
