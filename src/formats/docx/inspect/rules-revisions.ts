/**
 * Revision, comment and note rules: tracked changes left in the file, ids that clash, ranges that
 * never close, and references to comments, footnotes and endnotes that do not exist (or the
 * reverse). Read from every part that holds content, comments.xml, footnotes.xml, endnotes.xml
 * and settings.xml.
 */
import { isOn } from "../notation";
import { child, type XElement } from "../xml";
import { CHANGE_ELEMENTS, groupBy, plural, type Hit } from "./context";
import type { Rule } from "./rule";

const REVISIONS = "revisions";
const NOTES = "notes";

const KINDS: [string, string[]][] = [
  ["insertions", ["w:ins", "w:cellIns"]],
  ["deletions", ["w:del", "w:cellDel"]],
  ["moves", ["w:moveFrom", "w:moveTo"]],
  ["formatting", [...CHANGE_ELEMENTS]],
  ["merges", ["w:cellMerge"]],
];

/** Authors listed by name in the title; the rest are counted. */
const AUTHORS_NAMED = 3;

const tracked: Rule = {
  name: "tracked-changes",
  codes: ["revisions.tracked-changes", "revisions.tracking-on", "revisions.duplicate-id"],
  run(ctx) {
    const counts: Record<string, number> = {};
    const hits: Hit[] = [];
    const authors = new Set<string>();
    const byPart = new Map<string, { el: XElement; id: string }[]>();
    for (const part of ctx.stories()) {
      const ids: { el: XElement; id: string }[] = [];
      byPart.set(part, ids);
      for (const [kind, names] of KINDS)
        for (const name of names)
          for (const el of ctx.all(part, name)) {
            counts[kind] = (counts[kind] ?? 0) + 1;
            hits.push({ part, el, label: kind.replace(/s$/, "") });
            const author = el.attrs["w:author"];
            if (author) authors.add(author);
            const id = el.attrs["w:id"];
            if (id !== undefined && id !== "") ids.push({ el, id });
          }
    }
    const total = hits.length;
    if (total > 0) {
      const names = [...authors].sort();
      const shown = names.slice(0, AUTHORS_NAMED).join(", ");
      const more = names.length > AUTHORS_NAMED ? ` and ${names.length - AUTHORS_NAMED} more` : "";
      // Locations in document order within each part, parts in story order.
      ctx.report({
        rule: "revisions.tracked-changes",
        severity: "info",
        family: REVISIONS,
        title: `${plural(total, "tracked change")}${names.length > 0 ? ` by ${shown}${more}` : ""}`,
        why: "Tracked changes stay in the file until they are accepted or rejected. Anyone who opens it can see the deleted text and who changed what, so resolve them before sharing the document outside.",
        key: "tracked",
        hits,
        facts: {
          count: total,
          insertions: counts.insertions ?? 0,
          deletions: counts.deletions ?? 0,
          moves: counts.moves ?? 0,
          formatting: counts.formatting ?? 0,
          authors: authors.size,
        },
      });
    }
    for (const [part, ids] of byPart)
      for (const [id, list] of groupBy(ids, (x) => x.id)) {
        if (list.length < 2) continue;
        ctx.report({
          rule: "revisions.duplicate-id",
          severity: "warning",
          family: REVISIONS,
          title: `${list.length} tracked changes in ${part} share the id ${id}`,
          why: "Each tracked change should have its own id. Word copes with most duplicates, but accepting or rejecting one change may then act on another, and other programs may merge or drop them.",
          key: `${part}\u0000${id}`,
          hits: list.map((x) => ({ part, el: x.el, label: `revision ${id}` })),
          facts: { revisionId: id },
        });
      }

    const main = ctx.main();
    const settings = main ? ctx.related(main, "settings") : undefined;
    const flag = settings
      ? child(ctx.xml(settings)?.root ?? undefined, "w:trackRevisions")
      : undefined;
    if (settings && isOn(flag))
      ctx.report({
        rule: "revisions.tracking-on",
        severity: "info",
        family: REVISIONS,
        title: "Track changes is switched on",
        why: "Every edit anyone makes to this document will be recorded with their name and the time, and kept in the file until accepted or rejected.",
        key: "on",
        hits: [{ part: settings, el: flag }],
      });
  },
};

const moves: Rule = {
  name: "move-ranges",
  codes: ["revisions.unbalanced-move-range"],
  run(ctx) {
    const bad: Hit[] = [];
    const fromNames = new Map<string, Hit>();
    const toNames = new Map<string, Hit>();
    for (const part of ctx.stories())
      for (const [start, end, names] of [
        ["w:moveFromRangeStart", "w:moveFromRangeEnd", fromNames],
        ["w:moveToRangeStart", "w:moveToRangeEnd", toNames],
      ] as const) {
        const ends = new Set(ctx.all(part, end).map((e) => e.attrs["w:id"]));
        const starts = new Set<string | undefined>();
        for (const el of ctx.all(part, start)) {
          starts.add(el.attrs["w:id"]);
          const name = el.attrs["w:name"];
          if (name) names.set(name, { part, el, label: `move ${name}` });
          if (!ends.has(el.attrs["w:id"])) bad.push({ part, el, label: "range never ends" });
        }
        for (const el of ctx.all(part, end))
          if (!starts.has(el.attrs["w:id"]))
            bad.push({ part, el, label: "range end without a start" });
      }
    for (const [name, hit] of fromNames)
      if (!toNames.has(name)) bad.push({ ...hit, label: "moved from, but not to anywhere" });
    for (const [name, hit] of toNames)
      if (!fromNames.has(name)) bad.push({ ...hit, label: "moved to, but not from anywhere" });
    if (bad.length === 0) return;
    ctx.report({
      rule: "revisions.unbalanced-move-range",
      severity: "warning",
      family: REVISIONS,
      title: `${plural(bad.length, "move marker")} ${bad.length === 1 ? "does" : "do"} not pair up`,
      why: "A tracked move is recorded as a range where the text was and a matching range where it went, each with a start and an end. When a marker is missing, Word cannot show the move as a move, and accepting it may duplicate or lose the text.",
      key: "moves",
      hits: bad,
      facts: { count: bad.length },
    });
  },
};

const comments: Rule = {
  name: "comments",
  codes: ["notes.comment-missing", "notes.comment-unreferenced", "notes.comment-range-unclosed"],
  run(ctx) {
    const main = ctx.main();
    if (!main) return;
    const commentsPart = ctx.related(main, "comments");
    const defined = new Map<string, XElement>();
    if (commentsPart)
      for (const el of ctx.all(commentsPart, "w:comment")) {
        const id = el.attrs["w:id"];
        if (id !== undefined && !defined.has(id)) defined.set(id, el);
      }
    const referenced = new Set<string>();
    const dangling: Hit[] = [];
    const danglingIds = new Set<string>();
    const unclosed: Hit[] = [];
    for (const part of ctx.stories()) {
      if (part === commentsPart) continue;
      const ends = new Set(ctx.all(part, "w:commentRangeEnd").map((e) => e.attrs["w:id"]));
      for (const name of ["w:commentReference", "w:commentRangeStart"])
        for (const el of ctx.all(part, name)) {
          const id = el.attrs["w:id"] ?? "";
          referenced.add(id);
          if (!defined.has(id)) {
            dangling.push({ part, el, label: `comment ${id}` });
            danglingIds.add(id);
          }
          if (name === "w:commentRangeStart" && !ends.has(id))
            unclosed.push({ part, el, label: `comment ${id}` });
        }
    }
    if (dangling.length > 0)
      ctx.report({
        rule: "notes.comment-missing",
        severity: "error",
        family: NOTES,
        title: `${plural(danglingIds.size, "comment")} ${danglingIds.size === 1 ? "is" : "are"} referred to in the text but missing from ${commentsPart ?? "the package (there is no comments part)"}`,
        why: "The text marks where a comment belongs, but the comment itself does not exist. Word reports unreadable content and removes the markers when it repairs the file.",
        key: "missing",
        hits: dangling,
        facts: { comments: danglingIds.size, count: dangling.length },
      });
    if (unclosed.length > 0)
      ctx.report({
        rule: "notes.comment-range-unclosed",
        severity: "warning",
        family: NOTES,
        title: `${plural(unclosed.length, "comment range")} ${unclosed.length === 1 ? "starts" : "start"} but never ${unclosed.length === 1 ? "ends" : "end"}`,
        why: "A comment covers the text between its range start and range end. Without an end, Word cannot tell which text the comment is about and anchors it to a single point, or drops it.",
        key: "unclosed",
        hits: unclosed,
      });
    const orphans = [...defined].filter(([id]) => !referenced.has(id));
    if (commentsPart && orphans.length > 0)
      ctx.report({
        rule: "notes.comment-unreferenced",
        severity: "info",
        family: NOTES,
        title: `${plural(orphans.length, "comment")} in ${commentsPart} ${orphans.length === 1 ? "is" : "are"} not anchored anywhere in the text`,
        why: "Word shows a comment only where the text refers to it. These comments are never shown, but their text and authors are still in the file and go wherever the file goes.",
        key: "unreferenced",
        hits: orphans.map(([id, el]) => ({ part: commentsPart, el, label: `comment ${id}` })),
      });
  },
};

const NOTE_KINDS = [
  { type: "footnotes", note: "w:footnote", ref: "w:footnoteReference", word: "footnote" },
  { type: "endnotes", note: "w:endnote", ref: "w:endnoteReference", word: "endnote" },
] as const;

/** Separator notes are referenced by settings, not by the text. */
const SPECIAL_NOTE_TYPES = new Set(["separator", "continuationSeparator", "continuationNotice"]);

const notes: Rule = {
  name: "notes",
  codes: ["notes.note-missing", "notes.note-unreferenced"],
  run(ctx) {
    const main = ctx.main();
    if (!main) return;
    for (const kind of NOTE_KINDS) {
      const notesPart = ctx.related(main, kind.type);
      const defined = new Map<string, XElement>();
      if (notesPart)
        for (const el of ctx.all(notesPart, kind.note)) {
          const id = el.attrs["w:id"];
          if (id !== undefined && !defined.has(id)) defined.set(id, el);
        }
      const referenced = new Set<string>();
      const dangling: Hit[] = [];
      for (const part of ctx.stories()) {
        if (part === notesPart) continue;
        for (const el of ctx.all(part, kind.ref)) {
          const id = el.attrs["w:id"] ?? "";
          referenced.add(id);
          if (!defined.has(id)) dangling.push({ part, el, label: `${kind.word} ${id}` });
        }
      }
      if (dangling.length > 0)
        ctx.report({
          rule: "notes.note-missing",
          severity: "error",
          family: NOTES,
          title: `${plural(dangling.length, `${kind.word} reference`)} ${dangling.length === 1 ? "points" : "point"} at ${kind.word}s that ${notesPart ? `${notesPart} does not contain` : "do not exist (there is no part for them)"}`,
          why: `The text has a ${kind.word} mark, but the ${kind.word} it numbers does not exist. Word reports unreadable content, and the mark is removed or shows an empty note.`,
          key: kind.type,
          hits: dangling,
          facts: { kind: kind.word, count: dangling.length },
        });
      const unused = [...defined].filter(
        ([id, el]) => !referenced.has(id) && !SPECIAL_NOTE_TYPES.has(el.attrs["w:type"] ?? ""),
      );
      if (notesPart && unused.length > 0)
        ctx.report({
          rule: "notes.note-unreferenced",
          severity: "info",
          family: NOTES,
          title: `${plural(unused.length, kind.word)} in ${notesPart} ${unused.length === 1 ? "is" : "are"} never referred to in the text`,
          why: `A ${kind.word} is shown only where the text refers to it. These are never shown, but their text is still in the file.`,
          key: `${kind.type}-unused`,
          hits: unused.map(([id, el]) => ({ part: notesPart, el, label: `${kind.word} ${id}` })),
          facts: { kind: kind.word, count: unused.length },
        });
    }
  },
};

export const revisionRules: Rule[] = [tracked, moves, comments, notes];
