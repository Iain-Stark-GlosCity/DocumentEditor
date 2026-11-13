import { describe, expect, it } from "vitest";
import { countText, readingMinutes } from "./text-stats";

/** Runs `fn` with Intl.Segmenter removed, to exercise the fallback path. */
function withoutSegmenter<T>(fn: () => T): T {
  const original = Intl.Segmenter;
  Reflect.set(Intl, "Segmenter", undefined);
  try {
    return fn();
  } finally {
    Reflect.set(Intl, "Segmenter", original);
  }
}

describe("countText", () => {
  it("returns zeros and one line for the empty string", () => {
    expect(countText("")).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0, lines: 1 });
  });

  it("counts a plain English sentence", () => {
    expect(countText("The quick brown fox.")).toEqual({
      words: 4,
      characters: 20,
      charactersNoSpaces: 17,
      lines: 1,
    });
  });

  it("ignores repeated spaces, tabs and newlines when counting words", () => {
    // "one", "   ", "two", "\t\t", "three", "four" = 20 characters; 15 without whitespace.
    expect(countText("one   two\t\tthree\n\nfour\n")).toEqual({
      words: 4,
      characters: 20,
      charactersNoSpaces: 15,
      lines: 4,
    });
  });

  it("does not count line breaks as characters", () => {
    expect(countText("ab\ncd")).toEqual({
      words: 2,
      characters: 4,
      charactersNoSpaces: 4,
      lines: 2,
    });
    expect(countText("ab\r\ncd\re")).toMatchObject({ characters: 5, lines: 3 });
  });

  it("counts punctuation-only text as no words but as characters", () => {
    expect(countText("...!?")).toEqual({
      words: 0,
      characters: 5,
      charactersNoSpaces: 5,
      lines: 1,
    });
    expect(countText("- - -")).toMatchObject({ words: 0, characters: 5, charactersNoSpaces: 3 });
  });

  it("counts a contraction as one word", () => {
    expect(countText("don't").words).toBe(1);
    expect(countText("don't stop").words).toBe(2);
  });

  it("splits a hyphenated word into its parts (Intl.Segmenter treats the hyphen as a break)", () => {
    expect(countText("well-known").words).toBe(2);
    expect(countText("well-known").characters).toBe(10);
  });

  it("counts Chinese text using dictionary word segmentation", () => {
    const stats = countText("你好世界");
    expect(stats.words).toBe(2);
    expect(stats.characters).toBe(4);
  });

  it("counts an emoji with zero-width joiners as one character", () => {
    const family = "👨‍👩‍👧";
    expect(family.length).toBeGreaterThan(1);
    expect(countText(family).characters).toBe(1);
    expect(countText(`${family} ${family}`)).toMatchObject({
      characters: 3,
      charactersNoSpaces: 2,
    });
  });

  it("falls back to whitespace splitting and code points without Intl.Segmenter", () => {
    withoutSegmenter(() => {
      expect(countText("one  two\nthree")).toEqual({
        words: 3,
        characters: 13,
        charactersNoSpaces: 11,
        lines: 2,
      });
      expect(countText("👨‍👩‍👧").characters).toBe(5);
    });
  });

  it("handles a 1 MB string in well under two seconds", () => {
    const unit = "The quick brown fox jumps over the lazy dog.\n";
    const text = unit.repeat(Math.ceil((1024 * 1024) / unit.length));
    const started = performance.now();
    const stats = countText(text);
    const elapsed = performance.now() - started;
    expect(stats.words).toBe(9 * (text.length / unit.length));
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("readingMinutes", () => {
  it("is zero for no words and at least one otherwise", () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(-3)).toBe(0);
    expect(readingMinutes(1)).toBe(1);
  });

  it("rounds up at the default speed of 230 words per minute", () => {
    expect(readingMinutes(230)).toBe(1);
    expect(readingMinutes(231)).toBe(2);
    expect(readingMinutes(1000, 100)).toBe(10);
  });
});
