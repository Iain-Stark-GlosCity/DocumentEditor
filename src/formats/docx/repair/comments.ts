/**
 * Repairs for comments. Word keeps a comment in several places that must stay consistent: the
 * anchors and the reference run in each story part, the `w:comment` in the comments part, and one
 * entry each in the three optional extension parts (commentsExtended, commentsIds,
 * commentsExtensible). The parts themselves stay, only emptied: the patcher cannot delete parts.
 * Names and text of comments are never put in `details` or `summary`.
 */
import { elements, localName, type XElement } from "../xml";
import type { PartEditor } from "./splice";
import type { RepairContext, RepairDef, RepairResult } from "./types";

type Mode = "all" | "resolved";
type ExtraKind = "ex" | "ids" | "ext";

/** An attribute by its local name, whatever prefix the file used. */
function attrOf(el: XElement, local: string): string | undefined {
  for (const [key, value] of Object.entries(el.attrs)) if (localName(key) === local) return value;
  return undefined;
}

/** Every descendant element (depth first), not including `root`. */
function walk(root: XElement | null | undefined): XElement[] {
  const out: XElement[] = [];
  const visit = (el: XElement) => {
    for (const c of elements(el)) {
      out.push(c);
      visit(c);
    }
  };
  if (root) visit(root);
  return out;
}

interface CommentInfo {
  el: XElement;
  id: string | undefined;
  /** w14:paraId of the last paragraph: the key the extension parts use. */
  paraId: string | undefined;
}

interface Extra {
  part: string;
  editor: PartEditor | null;
  /** The entries of the part (w15:commentEx and so on). */
  entries: XElement[];
}

interface StoryMarks {
  part: string;
  editor: PartEditor | null;
  ranges: XElement[];
  refs: XElement[];
}

interface Analysis {
  /** True when the comments part exists but cannot be read: nothing is done. */
  damaged: boolean;
  commentsPart: string | undefined;
  comments: CommentInfo[];
  selected: CommentInfo[];
  replies: number;
  stories: StoryMarks[];
  /** Markers (ranges and references) whose comment does not exist. */
  orphanMarkers: number;
  commentEx: Extra | null;
  commentIds: Extra | null;
  commentExtensible: Extra | null;
  /** Durable ids of the selected comments (from commentsIds). */
  durableIds: Set<string>;
}

function relatedPart(ctx: RepairContext, type: string): string | undefined {
  try {
    const part = ctx.pkg.related(ctx.pkg.mainPart, type);
    return part && ctx.names.includes(part) ? part : undefined;
  } catch {
    return undefined;
  }
}

function extra(ctx: RepairContext, type: string, entryName: string): Extra | null {
  const part = relatedPart(ctx, type);
  if (!part) return null;
  const editor = ctx.editor(part);
  const entries = editor
    ? walk(editor.doc.root).filter((e) => localName(e.name) === entryName)
    : [];
  return { part, editor, entries };
}

function analyse(ctx: RepairContext, mode: Mode): Analysis {
  const commentsPart = relatedPart(ctx, "comments");
  const result: Analysis = {
    damaged: false,
    commentsPart,
    comments: [],
    selected: [],
    replies: 0,
    stories: [],
    orphanMarkers: 0,
    commentEx: null,
    commentIds: null,
    commentExtensible: null,
    durableIds: new Set(),
  };
  const commentsEditor = commentsPart ? ctx.editor(commentsPart) : null;
  if (commentsPart && !commentsEditor) {
    result.damaged = true;
    return result;
  }
  if (commentsEditor) {
    for (const el of walk(commentsEditor.doc.root)) {
      if (el.name !== "w:comment") continue;
      const paragraphs = walk(el).filter((e) => e.name === "w:p");
      const last = paragraphs[paragraphs.length - 1];
      result.comments.push({
        el,
        id: attrOf(el, "id"),
        paraId: last ? attrOf(last, "paraId") : undefined,
      });
    }
  }
  result.commentEx = extra(ctx, "commentsExtended", "commentEx");
  result.commentIds = extra(ctx, "commentsIds", "commentId");
  result.commentExtensible = extra(ctx, "commentsExtensible", "commentExtensible");

  // Threads: paraId -> done flag and parent paraId.
  const ex = new Map<string, { done: boolean; parent: string | undefined }>();
  for (const e of result.commentEx?.entries ?? []) {
    const paraId = attrOf(e, "paraId");
    if (paraId === undefined) continue;
    const done = attrOf(e, "done");
    ex.set(paraId, { done: done === "1" || done === "true", parent: attrOf(e, "paraIdParent") });
  }
  const parentOf = (c: CommentInfo): string | undefined =>
    c.paraId === undefined ? undefined : ex.get(c.paraId)?.parent;

  if (mode === "all") {
    result.selected = [...result.comments];
  } else {
    const byPara = new Map<string, CommentInfo>();
    for (const c of result.comments) if (c.paraId !== undefined) byPara.set(c.paraId, c);
    // A root is chosen when it is marked done; a reply only when its parent is chosen.
    const chosen = (c: CommentInfo, seen: Set<CommentInfo>): boolean => {
      if (seen.has(c)) return false;
      seen.add(c);
      const parent = parentOf(c);
      if (parent === undefined) return c.paraId !== undefined && ex.get(c.paraId)?.done === true;
      const p = byPara.get(parent);
      return p ? chosen(p, seen) : false;
    };
    result.selected = result.comments.filter((c) => chosen(c, new Set()));
  }
  result.replies = result.selected.filter((c) => parentOf(c) !== undefined).length;

  const selectedEls = new Set(result.selected.map((c) => c.el));
  const selectedIds = new Set<string>();
  const keptIds = new Set<string>();
  for (const c of result.comments) {
    if (c.id === undefined) continue;
    (selectedEls.has(c.el) ? selectedIds : keptIds).add(c.id);
  }
  const knownIds = new Set([...selectedIds, ...keptIds]);
  const removable = (id: string | undefined): boolean => {
    if (id === undefined || keptIds.has(id)) return false;
    return selectedIds.has(id) || (mode === "all" && !knownIds.has(id));
  };

  for (const part of ctx.stories()) {
    if (part === commentsPart) continue;
    const editor = ctx.editor(part);
    const ranges: XElement[] = [];
    const refs: XElement[] = [];
    if (editor) {
      for (const el of walk(editor.doc.root)) {
        const isRange = el.name === "w:commentRangeStart" || el.name === "w:commentRangeEnd";
        if (!isRange && el.name !== "w:commentReference") continue;
        const id = attrOf(el, "id");
        if (id === undefined || !removable(id)) continue;
        if (!knownIds.has(id)) result.orphanMarkers++;
        (isRange ? ranges : refs).push(el);
      }
    }
    result.stories.push({ part, editor, ranges, refs });
  }

  const paraIds = new Set<string>();
  for (const c of result.selected) if (c.paraId !== undefined) paraIds.add(c.paraId);
  for (const e of result.commentIds?.entries ?? []) {
    const paraId = attrOf(e, "paraId");
    const durable = attrOf(e, "durableId");
    if (durable !== undefined && paraId !== undefined && paraIds.has(paraId)) {
      result.durableIds.add(durable);
    }
  }
  return result;
}

/** Entries of an extension part that belong to the selection (all of them, for "remove all"). */
function entriesToRemove(a: Analysis, mode: Mode, x: Extra, kind: ExtraKind): XElement[] {
  if (mode === "all") return x.entries;
  const paraIds = new Set<string>();
  for (const c of a.selected) if (c.paraId !== undefined) paraIds.add(c.paraId);
  return x.entries.filter((e) => {
    if (kind === "ext") {
      const durable = attrOf(e, "durableId");
      return durable !== undefined && a.durableIds.has(durable);
    }
    const paraId = attrOf(e, "paraId");
    return paraId !== undefined && paraIds.has(paraId);
  });
}

/** Drops elements that sit inside another element of the list, so edits never overlap. */
function outermost(els: XElement[]): XElement[] {
  const set = new Set(els);
  return els.filter((el) => {
    for (let p = el.parent; p; p = p.parent) if (set.has(p)) return false;
    return true;
  });
}

/** What to remove for a story's references: the whole run when it holds nothing else. */
function referenceTargets(refs: XElement[]): XElement[] {
  const gone = new Set(refs);
  const out: XElement[] = [];
  const doneRuns = new Set<XElement>();
  for (const ref of refs) {
    const run = ref.parent;
    if (!run || run.name !== "w:r") {
      out.push(ref);
      continue;
    }
    if (doneRuns.has(run)) continue;
    const content = elements(run).filter((c) => c.name !== "w:rPr");
    if (content.every((c) => gone.has(c))) {
      doneRuns.add(run);
      out.push(run);
    } else {
      out.push(ref);
    }
  }
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function offerFor(ctx: RepairContext, mode: Mode): string | null {
  const a = analyse(ctx, mode);
  if (a.damaged) return null;
  if (a.selected.length === 0) {
    if (mode === "all" && a.orphanMarkers > 0) {
      return `${plural(a.orphanMarkers, "stray comment marker", "stray comment markers")} with no comment`;
    }
    return null;
  }
  if (mode === "resolved") {
    return plural(a.selected.length, "resolved comment", "resolved comments");
  }
  const base = plural(a.selected.length, "comment", "comments");
  if (a.replies === 0) return base;
  return `${base}, ${a.replies} of them ${a.replies === 1 ? "a reply" : "replies"}`;
}

function planFor(ctx: RepairContext, mode: Mode): RepairResult {
  const a = analyse(ctx, mode);
  const details: string[] = [];
  const skipped: string[] = [];
  if (a.damaged) {
    skipped.push(
      `${a.commentsPart ?? "The comments part"} could not be read, so nothing was changed`,
    );
    return { details, skipped };
  }

  const commentsEditor = a.commentsPart ? ctx.editor(a.commentsPart) : null;
  if (commentsEditor && a.selected.length > 0) {
    for (const c of a.selected) commentsEditor.remove(c.el);
    details.push(`${a.commentsPart}: removes ${plural(a.selected.length, "comment", "comments")}`);
  }

  for (const s of a.stories) {
    if (!s.editor) {
      skipped.push(`${s.part} could not be read, so its comment markers were left alone`);
      continue;
    }
    const targets = outermost([...s.ranges, ...referenceTargets(s.refs)]);
    for (const el of targets) s.editor.remove(el);
    if (targets.length > 0) {
      details.push(
        `${s.part}: removes ${plural(s.ranges.length, "comment range marker", "comment range markers")} and ${plural(s.refs.length, "comment reference", "comment references")}`,
      );
    }
  }

  const extras: [Extra | null, ExtraKind][] = [
    [a.commentEx, "ex"],
    [a.commentIds, "ids"],
    [a.commentExtensible, "ext"],
  ];
  for (const [x, kind] of extras) {
    if (!x) continue;
    if (!x.editor) {
      skipped.push(`${x.part} could not be read, so it was left alone`);
      continue;
    }
    const entries = entriesToRemove(a, mode, x, kind);
    for (const e of entries) x.editor.remove(e);
    if (entries.length > 0) {
      details.push(`${x.part}: removes ${plural(entries.length, "entry", "entries")}`);
    }
  }
  if (mode === "resolved") {
    const kept = a.comments.length - a.selected.length;
    details.push(`${plural(kept, "other comment", "other comments")} stay exactly as they are`);
  }
  details.push(
    "The comment parts stay in the file, emptied where needed. word/people.xml (the commenters' names) is not changed here: the privacy clean-up 'Anonymise authors' deals with names.",
  );
  return { details, skipped };
}

export const removeComments: RepairDef = {
  id: "docx.remove-comments",
  title: "Remove all comments",
  offer: (ctx) => offerFor(ctx, "all"),
  plan: (ctx) => planFor(ctx, "all"),
};

export const removeResolvedComments: RepairDef = {
  id: "docx.remove-resolved-comments",
  title: "Remove resolved comments",
  offer: (ctx) => offerFor(ctx, "resolved"),
  plan: (ctx) => planFor(ctx, "resolved"),
};

export const commentRepairs: RepairDef[] = [removeComments, removeResolvedComments];
