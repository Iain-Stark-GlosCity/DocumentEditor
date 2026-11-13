import { useEffect, useMemo, useRef, useState } from "react";
import type { Text } from "@codemirror/state";
import { countText, readingMinutes, type TextStats } from "../../core/text-stats";
import type { Feature, FeatureComponentProps } from "../feature";
import { useActiveDocument, useActiveEditorState, useSetting } from "../hooks";

/** Whole-document recounts wait for this much quiet time after the last edit. */
const DEBOUNCE_MS = 400;

const formatNumber = (n: number) => n.toLocaleString("en-GB");

function plural(n: number, word: string): string {
  return `${formatNumber(n)} ${n === 1 ? word : `${word}s`}`;
}

function detail(stats: TextStats): string {
  return [
    plural(stats.words, "word"),
    plural(stats.characters, "character"),
    `${formatNumber(stats.charactersNoSpaces)} characters without spaces`,
    plural(stats.lines, "line"),
    `about ${formatNumber(readingMinutes(stats.words))} min read`,
  ].join(", ");
}

/** Sums the counts of every non-empty selection range; null when the selection is all carets. */
function selectionStats(
  doc: Text,
  ranges: readonly { from: number; to: number; empty: boolean }[],
): TextStats | null {
  const total: TextStats = { words: 0, characters: 0, charactersNoSpaces: 0, lines: 0 };
  let any = false;
  for (const range of ranges) {
    if (range.empty) continue;
    any = true;
    const part = countText(doc.sliceString(range.from, range.to));
    total.words += part.words;
    total.characters += part.characters;
    total.charactersNoSpaces += part.charactersNoSpaces;
    total.lines += part.lines;
  }
  return any ? total : null;
}

function WordCount({ workbench }: FeatureComponentProps) {
  const enabled = useSetting(workbench, "statusBar.wordCount");
  const doc = useActiveDocument(workbench);
  const state = useActiveEditorState(workbench);
  const docId = doc?.id ?? null;
  const text = state?.doc ?? null;
  const selection = state?.selection ?? null;

  const [total, setTotal] = useState<{ docId: string; stats: TextStats } | null>(null);
  // The document last counted; a switch counts at once, an edit waits for the debounce.
  const countedDocId = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || docId === null || text === null) {
      countedDocId.current = null;
      return;
    }
    if (countedDocId.current !== docId) {
      countedDocId.current = docId;
      setTotal({ docId, stats: countText(text.toString()) });
      return;
    }
    const timer = setTimeout(() => {
      setTotal({ docId, stats: countText(text.toString()) });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, docId, text]);

  // Recomputed only when the selection or the text object changes, and only when non-empty.
  const selected = useMemo(
    () => (enabled && text && selection ? selectionStats(text, selection.ranges) : null),
    [enabled, text, selection],
  );

  if (!enabled || doc === null || total === null || total.docId !== docId) return null;

  const documentDetail = detail(total.stats);
  if (selected) {
    const label = `${formatNumber(selected.words)} of ${plural(total.stats.words, "word")}`;
    const full = `Selection: ${detail(selected)}. Document: ${documentDetail}`;
    return (
      <span title={full} aria-label={full}>
        {label}
      </span>
    );
  }
  return (
    <span title={documentDetail} aria-label={documentDetail}>
      {plural(total.stats.words, "word")}
    </span>
  );
}

/** Word count of the document, or of the selection, with the full counts on hover. */
export const wordCount: Feature = {
  id: "wordCount",
  statusItems: [{ id: "wordCount", align: "right", order: 5, component: WordCount }],
  commands: (wb) => [
    {
      id: "view.toggleWordCount",
      title: "Toggle word count",
      run: () => wb.settings.set("statusBar.wordCount", !wb.settings.get("statusBar.wordCount")),
    },
  ],
  menuItems: [{ menu: "view", group: "9_status", command: "view.toggleWordCount" }],
};
