/**
 * Column colouring for the source editor: each column gets one of eight hues (CSS variables, see
 * `styles/csv.css`) and delimiters are dimmed. Only the visible viewport is coloured.
 *
 * How reading resumes in the middle of a document
 * -----------------------------------------------
 * A quoted field can hold line breaks, so whether the first visible line starts a new row or
 * continues a quoted field depends on every quote above it. Re-reading from the top on each scroll
 * would be linear in the file size, so the answer is cached as scan checkpoints:
 *
 * - At the start of a physical line the reader (`lex.ts`) is in one of two states: at the start of
 *   a row, or inside a quoted field that began above (plus the column that field is in, so the
 *   colour is right). That is a `LexState`, a few bytes.
 * - `ScanCache` keeps an ascending list of `(line start offset, LexState)` checkpoints, beginning
 *   with offset 0. To colour a viewport that starts at line start P, it takes the nearest
 *   checkpoint at or before P, reads forward in chunks of about 64 KB (each chunk ends at a line
 *   boundary, and the state at its end becomes a new checkpoint), and ends with the exact state at
 *   P. A cold start in a 5 MB file reads at most the file once; scrolling afterwards reads at most
 *   one chunk beyond the nearest checkpoint.
 * - Invalidation is incremental. The state at an offset depends only on the text before it, so
 *   after an edit at offset X every checkpoint at or before X stays valid and later ones are
 *   dropped (they are recomputed on demand). Typing near the end of a big file keeps almost
 *   everything; typing at the top drops everything, but only the visible part is read again.
 * - The delimiter is part of the state, since it decides where a quote can open. Changing the
 *   setting rebuilds the extension, which starts from an empty cache.
 *
 * Above 5 MB nothing is coloured: the first cold scan would be noticeable and the colour of a
 * column far from the header is of little use at that size.
 */
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { StateField, type Extension, type Range, type Text } from "@codemirror/state";
import { lex, ROW_START, type Delimiter, type LexState } from "./lex";
import { resolveDelimiter } from "./parse";

export const MAX_COLOURED_CHARS = 5_000_000;
/** Read this much between checkpoints. */
const CHUNK = 64 * 1024;
/** Most characters read for one visible range. A single enormous line is coloured in part. */
const MAX_RANGE_CHARS = 200_000;
const MAX_MARKS = 40_000;
/** The delimiter is detected from this much of the start of the document. */
const DETECT_CHARS = 70_000;
export const COLUMN_HUES = 8;

const noHandler = { field() {}, rowEnd() {} };

interface Checkpoint {
  pos: number;
  state: LexState;
}

/** Checkpoints for one document and delimiter. See the file comment. */
export class ScanCache {
  private readonly points: Checkpoint[];
  /** Number of characters read, for tests. */
  scanned = 0;

  constructor(
    readonly doc: Text,
    readonly delimiter: Delimiter,
    points?: Checkpoint[],
  ) {
    this.points = points ?? [{ pos: 0, state: ROW_START }];
  }

  /** A cache for the edited document that keeps the checkpoints at or before `from`. */
  after(doc: Text, from: number): ScanCache {
    return new ScanCache(
      doc,
      this.delimiter,
      this.points.filter((p) => p.pos <= from),
    );
  }

  get checkpointCount(): number {
    return this.points.length;
  }

  /** The reader's state at `lineStart`, which must be the start of a line. */
  stateAt(lineStart: number): LexState {
    // Last checkpoint at or before lineStart.
    let lo = 0;
    let hi = this.points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.points[mid] as Checkpoint).pos <= lineStart) lo = mid;
      else hi = mid - 1;
    }
    let { pos, state } = this.points[lo] as Checkpoint;
    while (pos < lineStart) {
      // End this step at a line start about one chunk on, but not beyond the target.
      const probe = Math.min(pos + CHUNK, this.doc.length);
      const next = Math.min(lineStart, Math.min(this.doc.lineAt(probe).to + 1, this.doc.length));
      const end = Math.max(next, pos + 1);
      state = lex(this.doc.sliceString(pos, end), this.delimiter, state, noHandler, pos);
      this.scanned += end - pos;
      pos = end;
      this.insert({ pos, state });
    }
    return state;
  }

  private insert(point: Checkpoint): void {
    let i = this.points.length;
    while (i > 0 && (this.points[i - 1] as Checkpoint).pos > point.pos) i--;
    if ((this.points[i - 1] as Checkpoint | undefined)?.pos === point.pos) return;
    this.points.splice(i, 0, point);
  }
}

interface Scan {
  delimiter: Delimiter;
  cache: ScanCache;
}

/**
 * Holds the delimiter in use and the checkpoint cache. `setting` is the value of `csv.delimiter`.
 * The delimiter is worked out again after an edit only when the edit touches the part of the
 * document that detection reads.
 */
function scanField(setting: string, path: string | null) {
  const detect = (doc: Text): Delimiter =>
    resolveDelimiter(setting, doc.sliceString(0, Math.min(doc.length, DETECT_CHARS)), path);
  return StateField.define<Scan>({
    create(state) {
      const delimiter = detect(state.doc);
      return { delimiter, cache: new ScanCache(state.doc, delimiter) };
    },
    update(value, tr) {
      if (!tr.docChanged) return value;
      let first = tr.newDoc.length;
      let touchesStart = false;
      tr.changes.iterChangedRanges((fromA) => {
        first = Math.min(first, fromA);
        if (fromA < DETECT_CHARS) touchesStart = true;
      });
      const delimiter = touchesStart && setting === "auto" ? detect(tr.newDoc) : value.delimiter;
      if (delimiter !== value.delimiter) {
        return { delimiter, cache: new ScanCache(tr.newDoc, delimiter) };
      }
      return { delimiter, cache: value.cache.after(tr.newDoc, first) };
    },
  });
}

const columnMarks = Array.from({ length: COLUMN_HUES }, (_, i) =>
  Decoration.mark({ class: `cm-csv-c${i}` }),
);
const delimiterMark = Decoration.mark({ class: "cm-csv-delim" });

function build(view: EditorView, field: StateField<Scan>): DecorationSet {
  const { doc } = view.state;
  if (doc.length > MAX_COLOURED_CHARS) return Decoration.none;
  const { delimiter, cache } = view.state.field(field);
  const marks: Range<Decoration>[] = [];
  let doneTo = -1;
  for (const range of view.visibleRanges) {
    const first = doc.lineAt(range.from);
    const from = Math.max(first.from, doneTo);
    // `from` is a line start unless an earlier range already covered this line.
    if (from !== first.from) continue;
    const last = doc.lineAt(range.to);
    const to = Math.min(Math.min(last.to + 1, doc.length), from + MAX_RANGE_CHARS);
    doneTo = to;
    const state = cache.stateAt(from);
    lex(
      doc.sliceString(from, to),
      delimiter,
      state,
      {
        field(start, end, col, _quoted, delimiterAfter) {
          if (marks.length > MAX_MARKS) return;
          if (end > start) marks.push(columnMarks[col % COLUMN_HUES]!.range(start, end));
          if (delimiterAfter) marks.push(delimiterMark.range(end, end + 1));
        },
        rowEnd() {},
      },
      from,
    );
  }
  return Decoration.set(marks, true);
}

/**
 * Colours the visible columns of a delimited document. `setting` is `csv.delimiter` ("auto",
 * "comma", ...) and `path` the document's path (a `.tsv` file reads as tab-separated under auto).
 * Tab is not bound: it keeps its default behaviour, so keyboard focus is never trapped.
 */
export function csvColumns(setting: string, path: string | null): Extension {
  const field = scanField(setting, path);
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, field);
      }
      update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = build(update.view, field);
        }
      }
    },
    { decorations: (p) => p.decorations },
  );
  return [field, plugin];
}
