/**
 * Package rules: the zip of parts, the relationships between them and their content types (Open
 * Packaging Conventions). These are what Word checks first; a broken package is what makes Word
 * say "Word found unreadable content".
 */
import { extensionOf, groupBy, plural, sourceOfRels, type Hit } from "./context";
import type { Rule } from "./rule";
import { localName } from "../xml";

const FAMILY = "package";

/** Relationship types whose target normally lives outside the package. */
const USUALLY_EXTERNAL = new Set([
  "hyperlink",
  "attachedTemplate",
  "subDocument",
  "frame",
  "mailMergeSource",
  "mailMergeHeaderSource",
  "recipientData",
  "oleObject",
]);

function isRelsPart(name: string): boolean {
  return /(^|\/)_rels\/[^/]*\.rels$/i.test(name);
}

function isContentTypes(name: string): boolean {
  return name.toLowerCase() === "[content_types].xml";
}

/** Parts that hold XML, judged by their extension (the content type may be the defect). */
function isXmlPart(name: string): boolean {
  const ext = extensionOf(name);
  return ext === "xml" || ext === "rels" || ext === "vml";
}

const mainDocument: Rule = {
  name: "main-document",
  codes: ["package.no-main-document"],
  run(ctx) {
    const rels = ctx.rels("");
    if (rels.some((r) => r.type === "officeDocument" && !r.external)) return;
    const root = ctx.xml("_rels/.rels")?.root ?? undefined;
    ctx.report({
      rule: "package.no-main-document",
      severity: "error",
      family: FAMILY,
      title: root
        ? "The package relationships name no main document"
        : "The package has no _rels/.rels, so it names no main document",
      why: "Word finds the document body by following the officeDocument relationship in _rels/.rels. Without it Word cannot open the file, even if word/document.xml is present.",
      key: "main",
      hits: [root ? { part: "_rels/.rels", el: root } : { part: "_rels/.rels" }],
    });
  },
};

const relationships: Rule = {
  name: "relationships",
  codes: [
    "package.relationship-target-missing",
    "package.duplicate-relationship-id",
    "package.relationship-source-missing",
  ],
  run(ctx) {
    const main = ctx.main();
    // Header and footer references from the body are reported by the sections rule, which can
    // say which section lost its header; do not report the same defect twice.
    const sectionRefs = new Set<string>();
    if (main)
      for (const name of ["w:headerReference", "w:footerReference"])
        for (const el of ctx.all(main, name)) sectionRefs.add(el.attrs["r:id"] ?? "");

    const orphanRels: Hit[] = [];
    for (const relsPart of ctx.names.filter(isRelsPart)) {
      const source = sourceOfRels(relsPart);
      if (source === undefined) continue;
      if (source !== "" && !ctx.exists(source)) {
        const root = ctx.xml(relsPart)?.root;
        orphanRels.push({ part: relsPart, el: root ?? undefined });
        continue;
      }
      const rels = ctx.rels(source);
      const seen = new Map<string, number>();
      for (const rel of rels) {
        seen.set(rel.id, (seen.get(rel.id) ?? 0) + 1);
        if (seen.get(rel.id) === 2) {
          ctx.report({
            rule: "package.duplicate-relationship-id",
            severity: "error",
            family: FAMILY,
            title: `Relationship id ${rel.id} is used more than once in ${relsPart}`,
            why: "Relationship ids must be unique within a .rels part. Word reports the file as damaged, and which target a reference reaches is undefined.",
            key: `${relsPart}\u0000${rel.id}`,
            hits: rels
              .filter((r) => r.id === rel.id)
              .map((r) => ({ part: relsPart, el: r.el, label: `relationship ${r.id}` })),
            facts: { relationshipId: rel.id },
          });
        }
        if (rel.external || rel.rawTarget.startsWith("#") || rel.rawTarget === "") continue;
        if (ctx.exists(rel.target)) continue;
        if (source === main && (rel.type === "header" || rel.type === "footer"))
          if (sectionRefs.has(rel.id)) continue;
        const external = USUALLY_EXTERNAL.has(rel.type);
        ctx.report({
          rule: "package.relationship-target-missing",
          severity: external ? "warning" : "error",
          family: FAMILY,
          title: `Relationship ${rel.id} (${rel.type}) points at ${rel.target}, which is not in the package`,
          why: external
            ? 'This kind of relationship usually points outside the file, but this one is not marked TargetMode="External", so it is read as a missing part. The link or template it names will not work, and some tools report the file as damaged.'
            : "The part this relationship names does not exist. Whatever refers to it (an image, a header, the styles) is lost, and Word usually reports unreadable content and offers to repair the file.",
          key: `${relsPart}\u0000${rel.id}`,
          hits: [{ part: relsPart, el: rel.el, label: `relationship ${rel.id}` }],
          facts: { relationshipId: rel.id, type: rel.type, target: rel.target },
        });
      }
    }
    if (orphanRels.length > 0)
      ctx.report({
        rule: "package.relationship-source-missing",
        severity: "info",
        family: FAMILY,
        title: `${plural(orphanRels.length, "relationships part")} ${orphanRels.length === 1 ? "belongs to a part that does" : "belong to parts that do"} not exist`,
        why: "A .rels part describes the links of the part it is named after. When that part is gone, the .rels part is leftover clutter that nothing reads.",
        key: "rels-without-source",
        hits: orphanRels,
      });
  },
};

const contentTypes: Rule = {
  name: "content-types",
  codes: [
    "package.content-types-missing",
    "package.missing-content-type",
    "package.override-part-missing",
  ],
  run(ctx) {
    const root = ctx.xml("[Content_Types].xml")?.root;
    if (!root) {
      ctx.report({
        rule: "package.content-types-missing",
        severity: "error",
        family: FAMILY,
        title: "The package has no [Content_Types].xml",
        why: "Every Office file must say what kind of data each part holds. Without [Content_Types].xml Word cannot open the file.",
        key: "content-types",
        hits: [{ part: "[Content_Types].xml" }],
      });
      return;
    }
    const defaults = new Set<string>();
    const overrides = new Set<string>();
    const missingOverrides: Hit[] = [];
    for (const el of root.children) {
      if (typeof el === "string") continue;
      const local = localName(el.name);
      if (local === "Default") defaults.add((el.attrs.Extension ?? "").toLowerCase());
      else if (local === "Override") {
        let name = el.attrs.PartName ?? "";
        try {
          name = decodeURIComponent(name);
        } catch {
          // Keep the name as written.
        }
        name = name.replace(/^\//, "");
        overrides.add(name.toLowerCase());
        if (name !== "" && !ctx.exists(name))
          missingOverrides.push({ part: "[Content_Types].xml", el, label: `override for ${name}` });
      }
    }
    const untyped: Hit[] = [];
    for (const name of ctx.names) {
      if (isContentTypes(name)) continue;
      if (overrides.has(name.toLowerCase()) || defaults.has(extensionOf(name))) continue;
      untyped.push({ part: name });
    }
    if (untyped.length > 0)
      ctx.report({
        rule: "package.missing-content-type",
        severity: "error",
        family: FAMILY,
        title: `${plural(untyped.length, "part")} ${untyped.length === 1 ? "has" : "have"} no content type`,
        why: "Each part needs a content type, from an Override for the part or a Default for its extension in [Content_Types].xml. Word reports a part without one as unreadable content.",
        key: "untyped",
        hits: untyped,
      });
    if (missingOverrides.length > 0)
      ctx.report({
        rule: "package.override-part-missing",
        severity: "warning",
        family: FAMILY,
        title: `[Content_Types].xml declares ${plural(missingOverrides.length, "part")} that ${missingOverrides.length === 1 ? "does" : "do"} not exist`,
        why: "An Override names a part that is not in the package. Word usually ignores it, but it often means a part was deleted by a tool that did not clean up after itself, and strict package readers reject the file.",
        key: "overrides",
        hits: missingOverrides,
      });
  },
};

const references: Rule = {
  name: "relationship-references",
  codes: ["package.unresolved-relationship-reference"],
  run(ctx) {
    const main = ctx.main();
    for (const part of ctx.names) {
      if (!isXmlPart(part) || isRelsPart(part) || isContentTypes(part)) continue;
      const index = ctx.index(part);
      if (!index || index.relRefs.length === 0) continue;
      const ids = new Set(ctx.rels(part).map((r) => r.id));
      const missing = index.relRefs.filter((ref) => {
        if (ids.has(ref.value)) return false;
        // Reported by the sections rule.
        if (
          part === main &&
          (ref.el.name === "w:headerReference" || ref.el.name === "w:footerReference")
        )
          return false;
        return true;
      });
      for (const [id, refs] of groupBy(missing, (r) => r.value)) {
        ctx.report({
          rule: "package.unresolved-relationship-reference",
          severity: "error",
          family: FAMILY,
          title: `${plural(refs.length, "reference")} to relationship ${id} in ${part}, which ${part}'s relationships do not define`,
          why: "Images, links, charts and embedded objects reach their data through the relationships of the part they are in. This id is not among them, so Word cannot find what it refers to and usually reports unreadable content.",
          key: `${part}\u0000${id}`,
          hits: refs.map((r) => ({ part, el: r.el, label: `${r.attr}="${id}"` })),
          facts: { relationshipId: id },
        });
      }
    }
  },
};

const orphans: Rule = {
  name: "orphan-parts",
  codes: ["package.orphan-part"],
  run(ctx) {
    const reached = new Set<string>();
    const queue: string[] = [""];
    while (queue.length > 0) {
      const part = queue.shift()!;
      for (const rel of ctx.rels(part)) {
        if (rel.external) continue;
        const stored = ctx.find(rel.target);
        if (stored === undefined || reached.has(stored)) continue;
        reached.add(stored);
        queue.push(stored);
      }
    }
    if (reached.size === 0) return; // No package relationships: reported by main-document.
    const orphaned = ctx.names.filter(
      (n) => !reached.has(n) && !isRelsPart(n) && !isContentTypes(n),
    );
    if (orphaned.length === 0) return;
    ctx.report({
      rule: "package.orphan-part",
      severity: "info",
      family: FAMILY,
      title: `${plural(orphaned.length, "part")} ${orphaned.length === 1 ? "is" : "are"} not reachable from the package relationships`,
      why: "Word reads only the parts it reaches by following relationships from _rels/.rels. An unreachable part is ignored and is usually dropped when Word saves, but it still travels with the file, and may hold content (an old image, deleted comments) you did not expect to share.",
      key: "orphans",
      hits: orphaned.map((part) => ({ part })),
    });
  },
};

const caseCollisions: Rule = {
  name: "part-name-case",
  codes: ["package.part-name-case-collision"],
  run(ctx) {
    for (const [key, names] of groupBy(ctx.names, (n) => n.toLowerCase())) {
      if (names.length < 2) continue;
      ctx.report({
        rule: "package.part-name-case-collision",
        severity: "error",
        family: FAMILY,
        title: `${names.length} parts have the same name ignoring case: ${names.join(", ")}`,
        why: "Part names in an Office file are compared without regard to case, so these parts collide. Word reports the file as damaged, and which of the parts it reads is undefined.",
        key,
        hits: names.map((part) => ({ part })),
      });
    }
  },
};

const wellFormed: Rule = {
  name: "well-formed",
  codes: ["package.malformed-xml", "inspect.part-too-large"],
  run(ctx) {
    for (const part of ctx.names) {
      if (!isXmlPart(part)) continue;
      const doc = ctx.xml(part);
      if (!doc) continue;
      if (doc.problems.length === 0 && doc.root) continue;
      ctx.report({
        rule: "package.malformed-xml",
        severity: "error",
        family: FAMILY,
        title: `${part} is not well-formed XML`,
        why: "Word stops reading a part at the first XML error and reports the file as damaged; whatever follows the error may be lost when it repairs the file. The inspector read past the damage, so other findings in this part may be side effects of it.",
        key: part,
        hits: [{ part, el: doc.root ?? undefined }],
        facts: {
          problems: doc.problems.length,
          firstProblem: doc.problems[0] ?? "no root element",
        },
      });
    }
    const big = ctx.partsTooLarge();
    if (big.length > 0)
      ctx.report({
        rule: "inspect.part-too-large",
        severity: "info",
        family: FAMILY,
        title: `${plural(big.length, "part")} ${big.length === 1 ? "was" : "were"} too large to inspect`,
        why: "Very large parts are not parsed, so nothing inside them was checked.",
        key: "too-large",
        hits: big.map((part) => ({ part })),
      });
  },
};

export const packageRules: Rule[] = [
  mainDocument,
  relationships,
  contentTypes,
  references,
  orphans,
  caseCollisions,
];

/** Runs last, so that it can list parts that other rules found too large to parse. */
export const wellFormedRule = wellFormed;
