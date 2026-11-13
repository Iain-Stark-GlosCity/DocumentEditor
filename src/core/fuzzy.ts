/**
 * Fuzzy-ish matching for the command palette: every whitespace-separated word of the query
 * must appear in the text, in any order, ignoring case. Earlier and word-start matches rank
 * higher. Returns null for no match, otherwise a score where lower is better.
 */
export function matchScore(query: string, text: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const haystack = text.toLowerCase();
  let score = 0;
  for (const word of words) {
    const at = haystack.indexOf(word);
    if (at < 0) return null;
    const wordStart = at === 0 || /[\s\-_.:/]/.test(haystack.charAt(at - 1));
    score += at + (wordStart ? 0 : 50);
  }
  return score;
}

/** Filters and ranks items by `matchScore` on `label(item)`, keeping input order for ties. */
export function filterByQuery<T>(
  query: string,
  items: readonly T[],
  label: (item: T) => string,
): T[] {
  const scored: { item: T; index: number; score: number }[] = [];
  items.forEach((item, index) => {
    const score = matchScore(query, label(item));
    if (score !== null) scored.push({ item, index, score });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((r) => r.item);
}
