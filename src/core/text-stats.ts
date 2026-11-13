/**
 * Counts for a piece of text: words, characters and lines, and an estimated reading time.
 * Plain TypeScript with no React or Tauri imports (CLAUDE.md rule 3).
 */

export interface TextStats {
  words: number;
  /** Grapheme clusters, excluding line breaks. */
  characters: number;
  /** Grapheme clusters, excluding line breaks and any whitespace. */
  charactersNoSpaces: number;
  /** An empty string has one line. */
  lines: number;
}

const LINE_BREAK = /^(?:\r\n|\r|\n)$/;
const WHITESPACE = /^\s+$/;

/** Word segmentation handles CJK text and punctuation; whitespace splitting is the fallback. */
function countWords(text: string): number {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    let words = 0;
    for (const part of segmenter.segment(text)) if (part.isWordLike) words++;
    return words;
  }
  return text.split(/\s+/).filter((w) => w !== "").length;
}

function countCharacters(text: string): { characters: number; charactersNoSpaces: number } {
  let characters = 0;
  let charactersNoSpaces = 0;
  const count = (cluster: string) => {
    if (LINE_BREAK.test(cluster)) return;
    characters++;
    if (!WHITESPACE.test(cluster)) charactersNoSpaces++;
  };
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    for (const part of segmenter.segment(text)) count(part.segment);
  } else {
    for (const cluster of Array.from(text)) count(cluster);
  }
  return { characters, charactersNoSpaces };
}

/** Counts words, characters and lines in `text`. Line breaks are never counted as characters. */
export function countText(text: string): TextStats {
  const { characters, charactersNoSpaces } = countCharacters(text);
  return {
    words: countWords(text),
    characters,
    charactersNoSpaces,
    lines: text.split(/\r\n|\r|\n/).length,
  };
}

/** Estimated reading time in whole minutes, rounded up: zero for no words, otherwise at least one. */
export function readingMinutes(words: number, wordsPerMinute = 230): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}
