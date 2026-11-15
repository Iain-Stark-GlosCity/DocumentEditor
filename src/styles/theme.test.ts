/** WCAG AA contrast of the theme tokens, computed from `theme.css` itself, in both themes. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Vitest runs from the repository root.
const css = readFileSync("src/styles/theme.css", "utf8");

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    if (name && value) out[name] = value;
  }
  return out;
}

const lightBlock = css.split(':root[data-theme="light"]')[0] ?? "";
const darkBlock = css.split(':root[data-theme="dark"] {')[1]?.split("\n}")[0] ?? "";
const mediaBlock = css.split(":root:not([data-theme]) {")[1]?.split("\n  }")[0] ?? "";

const light = tokens(lightBlock);
const dark = { ...light, ...tokens(darkBlock) };

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text on a surface needs 4.5:1; borders, focus rings and icons need 3:1. */
const TEXT: [string, string][] = [
  ["fg", "bg"],
  ["fg", "bg-chrome"],
  ["fg", "bg-hover"],
  ["fg", "bg-pressed"],
  ["fg-muted", "bg"],
  ["fg-muted", "bg-chrome"],
  ["fg-muted", "bg-hover"],
  ["fg-muted", "bg-pressed"],
  ["fg-muted", "bg-elevated"],
  ["accent", "bg"],
  ["accent", "bg-chrome"],
  ["accent", "bg-hover"],
  ["accent-fg", "accent"],
  ["danger-fg", "danger-bg"],
  ["syn-heading", "bg"],
  ["syn-link", "bg"],
  ["syn-url", "bg"],
  ["syn-marker", "bg"],
  ["syn-meta", "bg"],
  ["syn-quote", "bg"],
  ["syn-code", "bg"],
  ["syn-keyword", "bg"],
  ["syn-string", "bg"],
  ["syn-number", "bg"],
  ["syn-fn", "bg"],
  ["syn-type", "bg"],
];
const UI: [string, string][] = [
  ["focus", "bg"],
  ["focus", "bg-chrome"],
  ["focus", "bg-hover"],
  ["focus", "bg-elevated"],
  ["border-strong", "bg"],
  ["border-strong", "bg-chrome"],
  ["border-strong", "bg-elevated"],
  ["accent", "bg-chrome"],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme contrast", (_name, theme) => {
  it.each(TEXT)("text token %s on %s is at least 4.5:1", (fg, bg) => {
    const a = theme[fg];
    const b = theme[bg];
    expect(a, `--${fg}`).toBeDefined();
    expect(b, `--${bg}`).toBeDefined();
    expect(contrast(a!, b!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI)("component token %s on %s is at least 3:1", (fg, bg) => {
    expect(contrast(theme[fg]!, theme[bg]!)).toBeGreaterThanOrEqual(3);
  });
});

describe("theme.css", () => {
  it("gives the system-dark fallback the same values as the explicit dark theme", () => {
    const explicit = tokens(darkBlock);
    const fallback = tokens(mediaBlock);
    expect(Object.keys(explicit).length).toBeGreaterThan(20);
    expect(fallback).toEqual(explicit);
  });

  it("switches animation off for people who ask for reduced motion", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.001ms/);
  });
});
