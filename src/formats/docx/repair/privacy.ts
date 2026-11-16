/**
 * Repairs that remove personal details from a document before it is shared.
 *
 * Notes on what this mechanism cannot do: parts cannot be deleted (only existing text parts are
 * rewritten), so `docProps/thumbnail.*` (a binary picture of page 1) is only reported, in the
 * `skipped` list of `docx.clear-descriptive-properties`.
 */
import {
  child,
  decodeEntities,
  descendants,
  elements,
  localName,
  textOf,
  type XElement,
} from "../xml";
import { tagEnd } from "./splice";
import type { RepairContext, RepairDef } from "./types";

/**
 * The document properties that name people or organisations: where the text of each is, by part.
 * (`dc:creator` and `cp:lastModifiedBy` in core.xml; `Company` and `Manager` in app.xml.)
 */
const PROPERTY_FIELDS: { part: string; names: string[]; label: string }[] = [
  {
    part: "docProps/core.xml",
    names: ["dc:creator", "cp:lastModifiedBy"],
    label: "core properties",
  },
  { part: "docProps/app.xml", names: ["ep:Company", "ep:Manager"], label: "extended properties" },
];

/** The property elements that hold text, in a part. */
function filled(ctx: RepairContext, part: string, names: string[]): XElement[] {
  const editor = ctx.editor(part);
  const root = editor?.doc.root;
  if (!editor || !root) return [];
  const out: XElement[] = [];
  for (const name of names) {
    for (const el of [child(root, name), ...descendants(root, name)]) {
      if (el && el.parent && textOf(el).trim() !== "" && !out.includes(el)) out.push(el);
    }
  }
  return out;
}

export const scrubProperties: RepairDef = {
  id: "docx.scrub-properties",
  title: "Remove names from the document properties",
  offer(ctx) {
    let count = 0;
    for (const f of PROPERTY_FIELDS) count += filled(ctx, f.part, f.names).length;
    return count === 0
      ? null
      : `${count} ${count === 1 ? "name or organisation" : "names or organisations"} in the properties`;
  },
  plan(ctx) {
    const details: string[] = [];
    for (const f of PROPERTY_FIELDS) {
      const els = filled(ctx, f.part, f.names);
      const editor = ctx.editor(f.part);
      if (!editor) continue;
      for (const el of els) editor.setInner(el, "");
      if (els.length > 0) {
        details.push(
          `${f.part}: empties ${els.length} ${els.length === 1 ? "field" : "fields"} (${f.label})`,
        );
      }
    }
    return { details, skipped: [] };
  },
};

/* ---------- attribute helpers (surgical edits inside a start tag) ---------- */

/** One attribute as written in a start tag, with the ranges needed to edit it in place. */
interface AttrSpan {
  /** The canonical name (`w:author`) after prefix lookup. */
  name: string;
  /** From the whitespace before the name to the end of the closing quote. */
  from: number;
  to: number;
  /** The text between the quotes. */
  valueFrom: number;
  valueTo: number;
  /** The value with entities decoded. */
  value: string;
}

const MAIN_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);
const W15_NAMESPACE = "http://schemas.microsoft.com/office/word/2012/wordml";

const SPAN_RE = /(\s*)([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** The attributes of an element's start tag, as written (raw names). Empty if unreadable. */
function rawSpans(source: string, el: XElement): AttrSpan[] {
  const bodyFrom = el.start + 1 + el.rawName.length;
  if (source.slice(el.start + 1, bodyFrom) !== el.rawName) return [];
  const end = tagEnd(source, el.start + 1);
  if (end < 0) return [];
  const body = source.slice(bodyFrom, end);
  const out: AttrSpan[] = [];
  const re = new RegExp(SPAN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const whole = m[0];
    const quoted = m[3]!;
    const at = bodyFrom + m.index;
    const valueTo = at + whole.length - 1;
    out.push({
      name: m[2]!,
      from: at,
      to: at + whole.length,
      valueFrom: valueTo - (quoted.length - 2),
      valueTo,
      value: decodeEntities(m[4] ?? m[5] ?? ""),
    });
  }
  return out;
}

/** Prefix scopes by element (raw prefix -> canonical prefix, for the namespaces we use). */
const scopes = new WeakMap<XElement, Map<string, string>>();

function scopeOf(source: string, el: XElement): Map<string, string> {
  const known = scopes.get(el);
  if (known) return known;
  let scope = el.parent ? scopeOf(source, el.parent) : new Map<string, string>();
  const end = tagEnd(source, el.start + 1);
  if (end >= 0 && source.slice(el.start, end).includes("xmlns:")) {
    scope = new Map(scope);
    for (const span of rawSpans(source, el)) {
      if (!span.name.startsWith("xmlns:")) continue;
      const prefix = span.name.slice(6);
      if (MAIN_NAMESPACES.has(span.value)) scope.set(prefix, "w");
      else if (span.value === W15_NAMESPACE) scope.set(prefix, "w15");
      else scope.delete(prefix);
    }
  }
  scopes.set(el, scope);
  return scope;
}

/** The attributes of an element with canonical names (`w:author`), from the source text. */
function attrSpans(source: string, el: XElement): AttrSpan[] {
  const scope = scopeOf(source, el);
  const out: AttrSpan[] = [];
  for (const span of rawSpans(source, el)) {
    if (span.name === "xmlns" || span.name.startsWith("xmlns:")) continue;
    const colon = span.name.indexOf(":");
    if (colon < 0) {
      out.push(span);
      continue;
    }
    const mapped = scope.get(span.name.slice(0, colon));
    out.push({ ...span, name: mapped ? `${mapped}:${span.name.slice(colon + 1)}` : span.name });
  }
  return out;
}

/** Every element of a tree in document order (iterative: deep documents cannot overflow). */
function* walk(root: XElement): Generator<XElement> {
  const stack: XElement[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    yield el;
    const kids = elements(el);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
}

/** Parts that exist in the package but cannot be edited safely (damaged XML). */
function damaged(ctx: RepairContext, parts: string[]): string[] {
  return parts.filter((p) => ctx.names.includes(p) && ctx.editor(p) === null);
}

function damagedLines(parts: string[]): string[] {
  return parts.map((p) => `${p}: left alone because it could not be read safely`);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ---------- 1. anonymise authors ---------- */

const PEOPLE_PART = "word/people.xml";
const COMMENTS_PART = "word/comments.xml";

/** The parts that can hold authors, in the fixed order pseudonyms are numbered in. */
function authorParts(ctx: RepairContext): string[] {
  const parts = [...ctx.stories()];
  if (ctx.names.includes(COMMENTS_PART) && !parts.includes(COMMENTS_PART)) {
    parts.push(COMMENTS_PART);
  }
  // Change records also sit outside the stories: a formatting change in a style definition or a
  // numbering level, the glossary (building blocks) document. Any other XML part that has an
  // author attribute is scanned too; only `w:author` (in the WordprocessingML namespace) is changed.
  for (const name of ctx.names) {
    if (parts.includes(name) || name === PEOPLE_PART || !/\.xml$/i.test(name)) continue;
    if (/author\s*=/.test(ctx.text(name) ?? "")) parts.push(name);
  }
  return parts;
}

interface AuthorEdit {
  part: string;
  from: number;
  to: number;
  insert: string;
}

interface AuthorScan {
  edits: AuthorEdit[];
  /** Different original names met (a count only). */
  people: number;
  /** Parts with at least one edit. */
  parts: Set<string>;
  /** Comments with initials but no author to take a pseudonym from. */
  unmatchedInitials: number;
  /** People entries without a name. */
  unnamedPeople: number;
  /** Sign-in details with only one of the provider and the user id: left alone. */
  oddSignIns: number;
  damaged: string[];
}

/** Finds every author attribute to replace. Pure: edits nothing. */
function scanAuthors(ctx: RepairContext): AuthorScan {
  const numbers = new Map<string, number>();
  const numberOf = (name: string): number => {
    let n = numbers.get(name);
    if (n === undefined) {
      n = numbers.size + 1;
      numbers.set(name, n);
    }
    return n;
  };
  const scan: AuthorScan = {
    edits: [],
    people: 0,
    parts: new Set(),
    unmatchedInitials: 0,
    unnamedPeople: 0,
    oddSignIns: 0,
    damaged: [],
  };
  const set = (part: string, span: AttrSpan, insert: string) => {
    if (span.value === insert) return;
    scan.edits.push({ part, from: span.valueFrom, to: span.valueTo, insert });
    scan.parts.add(part);
  };
  const all = [...authorParts(ctx), PEOPLE_PART];
  scan.damaged = damaged(ctx, all);
  for (const part of all) {
    const editor = ctx.editor(part);
    const root = editor?.doc.root;
    if (!editor || !root) continue;
    const source = editor.source;
    for (const el of walk(root)) {
      if (part === PEOPLE_PART) {
        if (el.name !== "w15:person") continue;
        const author = attrSpans(source, el).find((s) => s.name === "w15:author");
        if (!author || author.value === "") {
          scan.unnamedPeople++;
          continue;
        }
        const pseudonym = `Author ${numberOf(author.value)}`;
        set(part, author, pseudonym);
        // The sign-in details identify the person: use the provider Word writes for a person who
        // is not signed in ("None"), with the pseudonym where that provider keeps the name.
        const info = child(el, "w15:presenceInfo");
        if (info) {
          const infoSpans = attrSpans(source, info);
          const provider = infoSpans.find((s) => s.name === "w15:providerId");
          const user = infoSpans.find((s) => s.name === "w15:userId");
          if (provider && user) {
            set(part, provider, "None");
            set(part, user, pseudonym);
          } else if (provider || user) scan.oddSignIns++;
        }
        continue;
      }
      const hasAuthor = el.attrs["w:author"] !== undefined;
      const hasInitials = el.name === "w:comment" && el.attrs["w:initials"] !== undefined;
      if (!hasAuthor && !hasInitials) continue;
      const spans = attrSpans(source, el);
      const author = spans.find((s) => s.name === "w:author");
      const named = author !== undefined && author.value !== "";
      if (author && named) set(part, author, `Author ${numberOf(author.value)}`);
      const initials = hasInitials ? spans.find((s) => s.name === "w:initials") : undefined;
      if (initials && initials.value !== "") {
        if (author && named) set(part, initials, `A${numberOf(author.value)}`);
        else scan.unmatchedInitials++;
      }
    }
  }
  scan.people = numbers.size;
  return scan;
}

export const anonymiseAuthors: RepairDef = {
  id: "docx.anonymise-authors",
  title: "Replace author names in tracked changes and comments",
  offer(ctx) {
    const scan = scanAuthors(ctx);
    if (scan.edits.length === 0) return null;
    return `${plural(scan.edits.length, "author value", "author values")} for ${plural(scan.people, "person", "people")}`;
  },
  plan(ctx) {
    const scan = scanAuthors(ctx);
    for (const edit of scan.edits) ctx.editor(edit.part)?.splice(edit.from, edit.to, edit.insert);
    const details = [
      `Replaces ${plural(scan.edits.length, "value", "values")} in ${plural(scan.parts.size, "part", "parts")} with the pseudonyms Author 1, Author 2 and so on.`,
      `${plural(scan.people, "person is", "people are")} given a pseudonym. The same person always gets the same one, so who changed what stays traceable.`,
      "Comment initials become A1, A2 and so on. Dates and the text of changes and comments are not touched.",
    ];
    if (scrubProperties.offer(ctx) !== null) {
      details.push(
        "Names in the document properties (author, last saved by, company, manager) are not changed here: 'Remove names from the document properties' does that.",
      );
    }
    if (scan.parts.has(PEOPLE_PART)) {
      details.push(
        `${PEOPLE_PART}: names are replaced and the sign-in details are set to the "None" provider that Word writes for someone who is not signed in.`,
      );
    }
    const skipped = damagedLines(scan.damaged);
    if (scan.unmatchedInitials > 0) {
      skipped.push(
        `${plural(scan.unmatchedInitials, "comment has", "comments have")} initials but no author name, so the initials were left alone`,
      );
    }
    if (scan.oddSignIns > 0) {
      skipped.push(
        `${plural(scan.oddSignIns, "entry in the people list has", "entries in the people list have")} sign-in details written in an unusual way, so the sign-in details were left alone (they may identify the person)`,
      );
    }
    if (scan.unnamedPeople > 0) {
      skipped.push(
        `${plural(scan.unnamedPeople, "entry in the people list has", "entries in the people list have")} no name and was left alone`,
      );
    }
    return { details, skipped };
  },
};

/* ---------- 2. remove rsids ---------- */

const RSID_ATTRS = new Set([
  "w:rsidR",
  "w:rsidRPr",
  "w:rsidRDefault",
  "w:rsidP",
  "w:rsidDel",
  "w:rsidSect",
  "w:rsidTr",
]);

interface RsidScan {
  attributes: number;
  elements: number;
  parts: Set<string>;
  damaged: string[];
}

function rsidParts(ctx: RepairContext): string[] {
  const parts = [...ctx.stories()];
  for (const p of ["word/styles.xml", "word/settings.xml"]) {
    if (ctx.names.includes(p) && !parts.includes(p)) parts.push(p);
  }
  return parts;
}

/** Walks the parts; when `apply` is true the removals are recorded in the part editors. */
function scanRsids(ctx: RepairContext, apply: boolean): RsidScan {
  const scan: RsidScan = { attributes: 0, elements: 0, parts: new Set(), damaged: [] };
  const parts = rsidParts(ctx);
  scan.damaged = damaged(ctx, parts);
  for (const part of parts) {
    const editor = ctx.editor(part);
    const root = editor?.doc.root;
    if (!editor || !root) continue;
    const source = editor.source;
    const stack: XElement[] = [root];
    while (stack.length) {
      const el = stack.pop()!;
      // The list in settings.xml and a style's own id in styles.xml are elements.
      if (el.name === "w:rsids" || (el.name === "w:rsid" && el.parent?.name === "w:style")) {
        scan.elements++;
        scan.parts.add(part);
        if (apply) editor.remove(el);
        continue;
      }
      if (Object.keys(el.attrs).some((k) => RSID_ATTRS.has(k))) {
        for (const span of attrSpans(source, el)) {
          if (!RSID_ATTRS.has(span.name)) continue;
          scan.attributes++;
          scan.parts.add(part);
          // The whitespace before the name goes too, so the tag stays tidy.
          if (apply) editor.splice(span.from, span.to, "");
        }
      }
      for (const c of elements(el)) stack.push(c);
    }
  }
  return scan;
}

export const removeRsids: RepairDef = {
  id: "docx.remove-rsids",
  title: "Remove editing-session ids (rsids)",
  offer(ctx) {
    const scan = scanRsids(ctx, false);
    const total = scan.attributes + scan.elements;
    return total === 0
      ? null
      : `${plural(total, "editing-session id", "editing-session ids")} in ${plural(scan.parts.size, "part", "parts")}`;
  },
  plan(ctx) {
    const scan = scanRsids(ctx, true);
    return {
      details: [
        `Removes ${plural(scan.attributes, "editing-session attribute", "editing-session attributes")} and ${plural(scan.elements, "list entry", "list entries")} from ${plural(scan.parts.size, "part", "parts")}.`,
        "These ids only record which editing sessions touched which text. Word makes new ones when the file is next edited, and the text and formatting do not change.",
      ],
      skipped: damagedLines(scan.damaged),
    };
  },
};

/* ---------- 3. remove custom properties ---------- */

const CUSTOM_PART = "docProps/custom.xml";
const APP_PART = "docProps/app.xml";
const APP_PATH_FIELDS = ["ep:Template", "ep:HyperlinkBase"];

function customProperties(ctx: RepairContext): XElement[] {
  const root = ctx.editor(CUSTOM_PART)?.doc.root;
  return root ? elements(root).filter((e) => localName(e.name) === "property") : [];
}

export const removeCustomProperties: RepairDef = {
  id: "docx.remove-custom-properties",
  title: "Remove custom document properties",
  offer(ctx) {
    const props = customProperties(ctx).length;
    const fields = filled(ctx, APP_PART, APP_PATH_FIELDS).length;
    if (props + fields === 0) return null;
    const parts: string[] = [];
    if (props > 0) parts.push(plural(props, "custom property", "custom properties"));
    if (fields > 0) {
      parts.push(plural(fields, "template or address field", "template or address fields"));
    }
    return parts.join(" and ");
  },
  plan(ctx) {
    const details: string[] = [];
    const props = customProperties(ctx);
    const custom = ctx.editor(CUSTOM_PART);
    if (custom && props.length > 0) {
      for (const el of props) custom.remove(el);
      details.push(
        `${CUSTOM_PART}: removes ${plural(props.length, "custom property", "custom properties")}. The list stays, empty. This also removes values some tools store there, such as sensitivity labels, and fields that show a custom property will have nothing to show.`,
      );
    }
    const fields = filled(ctx, APP_PART, APP_PATH_FIELDS);
    const app = ctx.editor(APP_PART);
    if (app && fields.length > 0) {
      for (const el of fields) app.setInner(el, "");
      details.push(
        `${APP_PART}: empties ${plural(fields.length, "field", "fields")} that can hold a template path or a web address.`,
      );
    }
    const skipped = damagedLines(damaged(ctx, [CUSTOM_PART, APP_PART]));
    const template = attachedTemplateRels(ctx);
    if (template) {
      skipped.push(
        `${template}: the path of the attached template is kept. It can include a user name or a folder name; this clean-up does not change relationships.`,
      );
    }
    return { details, skipped };
  },
};

/** The relationships part that holds an external attached template, if there is one. */
function attachedTemplateRels(ctx: RepairContext): string | undefined {
  try {
    const settings = ctx.pkg.related(ctx.pkg.mainPart, "settings");
    if (!settings) return undefined;
    for (const rel of ctx.pkg.relsOf(settings).values()) {
      if (rel.type === "attachedTemplate" && rel.external) {
        const slash = settings.lastIndexOf("/");
        return `${settings.slice(0, slash + 1)}_rels/${settings.slice(slash + 1)}.rels`;
      }
    }
  } catch {
    // An unreadable settings part has nothing to report.
  }
  return undefined;
}

/* ---------- 4. clear descriptive properties ---------- */

const CORE_PART = "docProps/core.xml";
const DESCRIPTIVE_FIELDS = [
  "dc:title",
  "dc:subject",
  "cp:keywords",
  "dc:description",
  "cp:category",
  "cp:contentStatus",
];

/**
 * Word also writes the title into app.xml (`TitlesOfParts`). Only entries that are exactly the
 * title in core.xml are emptied: anything else in that list is not known to be the title.
 */
function titleCopies(ctx: RepairContext): XElement[] {
  const title = filled(ctx, CORE_PART, ["dc:title"])[0];
  const value = title ? textOf(title).trim() : "";
  const root = ctx.editor(APP_PART)?.doc.root;
  if (value === "" || !root) return [];
  return descendants(child(root, "ep:TitlesOfParts"), "vt:lpstr").filter(
    (el) => textOf(el).trim() === value,
  );
}

export const clearDescriptiveProperties: RepairDef = {
  id: "docx.clear-descriptive-properties",
  title: "Clear title, subject, keywords and description",
  offer(ctx) {
    const count = filled(ctx, CORE_PART, DESCRIPTIVE_FIELDS).length;
    return count === 0
      ? null
      : `${plural(count, "descriptive field", "descriptive fields")} with text`;
  },
  plan(ctx) {
    const els = filled(ctx, CORE_PART, DESCRIPTIVE_FIELDS);
    const copies = titleCopies(ctx);
    const editor = ctx.editor(CORE_PART);
    if (editor) for (const el of els) editor.setInner(el, "");
    const app = ctx.editor(APP_PART);
    if (app) for (const el of copies) app.setInner(el, "");
    const skipped = damagedLines(damaged(ctx, [CORE_PART]));
    // A preview picture of page 1 can show the document's content. Parts cannot be deleted by
    // this mechanism (only existing text parts are rewritten), so it is reported, not changed.
    // It is listed here because it is a descriptive extra of the file, like the title.
    const thumbnail = ctx.names.find((n) => /^docProps\/thumbnail\./i.test(n));
    if (thumbnail) {
      skipped.push(
        `${thumbnail}: a small picture of the first page is stored in the file. It cannot be removed here, so it was left alone.`,
      );
    }
    return {
      details: [
        `${CORE_PART}: empties ${plural(els.length, "field", "fields")} (title, subject, keywords, description, category or status).`,
        ...(copies.length > 0
          ? [`${APP_PART}: empties the copy of the title in the list of titles.`]
          : []),
        "This also removes the title shown for the file in file lists and search results.",
      ],
      skipped,
    };
  },
};

export const privacyRepairs: RepairDef[] = [
  scrubProperties,
  anonymiseAuthors,
  removeRsids,
  removeCustomProperties,
  clearDescriptiveProperties,
];
