import { describe, expect, it } from "vitest";
import { sameIgnoringLines, updateBlocks } from "./blockDiff";

function host(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

function fragment(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

/** Blocks separated by newlines (as the pipeline does), numbered by their position. */
const blocks = (...items: string[]) =>
  items.map((h, i) => h.replace("#", String(i * 2 + 1))).join("\n");

const T = '<h1 data-line="#">T</h1>';
const p = (text: string) => `<p data-line="#">${text}</p>`;

describe("sameIgnoringLines", () => {
  it("ignores data-line at any depth", () => {
    const a = host('<ul data-line="1"><li data-line="1">x</li></ul>').firstElementChild!;
    const b = host('<ul data-line="7"><li data-line="8">x</li></ul>').firstElementChild!;
    expect(sameIgnoringLines(a, b)).toBe(true);
  });

  it("notices other differences", () => {
    const a = host('<p data-line="1">x</p>').firstElementChild!;
    expect(sameIgnoringLines(a, host('<p data-line="1">y</p>').firstElementChild!)).toBe(false);
    expect(sameIgnoringLines(a, host('<p data-line="1" id="a">x</p>').firstElementChild!)).toBe(
      false,
    );
    expect(sameIgnoringLines(a, host("<p>x</p>").firstElementChild!)).toBe(true);
    expect(sameIgnoringLines(a, host("<div>x</div>").firstElementChild!)).toBe(false);
  });
});

describe("updateBlocks", () => {
  const original = blocks(T, p("one"), p("two"), p("three"));

  it("changes nothing when nothing changed", () => {
    const el = host(original);
    const before = Array.from(el.children);
    const result = updateBlocks(el, fragment(original));
    expect(result).toEqual({ kept: 4, removed: 0, inserted: 0 });
    expect(Array.from(el.children)).toEqual(before);
  });

  it("replaces only the block that changed", () => {
    const el = host(original);
    const before = Array.from(el.children);
    const result = updateBlocks(el, fragment(original.replace("two", "TWO")));
    expect(result).toEqual({ kept: 3, removed: 1, inserted: 1 });
    expect(el.children[0]).toBe(before[0]);
    expect(el.children[1]).toBe(before[1]);
    expect(el.children[2]).not.toBe(before[2]);
    expect(el.children[2]?.textContent).toBe("TWO");
    expect(el.children[3]).toBe(before[3]);
  });

  it("inserts a block and keeps the ones below, refreshing their line numbers", () => {
    const el = host(original);
    const before = Array.from(el.children);
    const result = updateBlocks(el, fragment(blocks(T, p("new"), p("one"), p("two"), p("three"))));
    expect(result).toEqual({ kept: 4, removed: 0, inserted: 1 });
    expect(el.children[2]).toBe(before[1]);
    expect(el.children[4]).toBe(before[3]);
    expect(Array.from(el.children).map((c) => c.getAttribute("data-line"))).toEqual([
      "1",
      "3",
      "5",
      "7",
      "9",
    ]);
  });

  it("removes blocks", () => {
    const el = host(original);
    const before = Array.from(el.children);
    updateBlocks(el, fragment(blocks(T, p("three"))));
    expect(el.children).toHaveLength(2);
    expect(el.children[0]).toBe(before[0]);
    expect(el.children[1]).toBe(before[3]);
  });

  it("fills an empty container and appends after the last block", () => {
    const el = host("");
    updateBlocks(el, fragment(original));
    expect(el.children).toHaveLength(4);
    const first = el.children[0];
    updateBlocks(el, fragment(original + '\n<p data-line="9">four</p>'));
    expect(el.children).toHaveLength(5);
    expect(el.children[0]).toBe(first);
  });

  it("empties the container for an empty document", () => {
    const el = host(original);
    updateBlocks(el, fragment(""));
    expect(el.childNodes).toHaveLength(0);
  });

  it("leaves untouched blocks, and so a selection inside them, alone", () => {
    const el = host(original);
    document.body.append(el);
    const text = el.children[1]!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 3);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    updateBlocks(el, fragment(original.replace("three", "THREE")));
    expect(window.getSelection()!.toString()).toBe("ne");
    el.remove();
  });
});
