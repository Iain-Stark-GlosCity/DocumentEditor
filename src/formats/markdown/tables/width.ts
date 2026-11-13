/**
 * Display width of a string in a monospace column: East Asian wide characters and emoji count
 * 2, combining marks and zero-width characters count 0, everything else 1. Used to align table
 * columns. Small and dependency-free by design; it follows wcwidth with emoji awareness.
 */

const ASCII = /^[\x20-\x7e]*$/;
const ZERO = /^[\p{Mn}\p{Me}\p{Cf}\p{Emoji_Modifier}]$/u;
const EMOJI_WIDE = /^\p{Emoji_Presentation}$/u;
const PICTOGRAPHIC = /^\p{Extended_Pictographic}$/u;

const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, CJK compatibility
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo extended A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd], // CJK extensions B and later
];

function isWide(cp: number): boolean {
  for (const [lo, hi] of WIDE_RANGES) if (cp >= lo && cp <= hi) return true;
  return false;
}

export function displayWidth(text: string): number {
  if (ASCII.test(text)) return text.length;
  let width = 0;
  let joined = false; // the previous character was a zero-width joiner
  let lastWidth = 0;
  let lastPictographic = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x200d) {
      joined = true;
      continue;
    }
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue;
    if (cp === 0xfe0f) {
      // Emoji presentation selector: a text-width pictograph becomes a wide emoji.
      if (lastPictographic && lastWidth === 1) {
        width += 1;
        lastWidth = 2;
      }
      continue;
    }
    if (ZERO.test(ch)) continue;
    const pictographic = PICTOGRAPHIC.test(ch);
    let w = isWide(cp) || EMOJI_WIDE.test(ch) ? 2 : 1;
    if (joined && pictographic) w = 0; // part of a ZWJ sequence, drawn as one glyph
    joined = false;
    width += w;
    lastWidth = w;
    lastPictographic = pictographic;
  }
  return width;
}
