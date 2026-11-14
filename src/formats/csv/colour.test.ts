// @vitest-environment jsdom
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { COLUMN_HUES, csvColumns, ScanCache } from "./colour";
import { lex, ROW_START, type LexState } from "./lex";

/** The state at the start of every line, by reading the whole text from the top. */
function lineStates(text: string, delimiter: "," | ";"): Map<number, LexState> {
  const states = new Map<number, LexState>();
  let state: LexState = ROW_START;
  let pos = 0;
  for (const line of text.split("\n")) {
    states.set(pos, state);
    state = lex(line + "\n", delimiter, state, { field() {}, rowEnd() {} });
    pos += line.length + 1;
  }
  return states;
}

function sample(rows: number): string {
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    // Every 7th row has a quoted field that spans lines; every 11th has a lone quote in a field.
    if (i % 7 === 0) lines.push(`${i},"first line`, `second, line ""quoted""`, `last",tail`);
    else if (i % 11 === 0) lines.push(`${i},5" pipe,x`);
    else lines.push(`${i},a,b,c`);
  }
  return lines.join("\n") + "\n";
}

describe("ScanCache", () => {
  it("gives the same state as reading from the top, at every line start", () => {
    const text = sample(6000);
    const expected = lineStates(text, ",");
    const cache = new ScanCache(Text.of(text.split("\n")), ",");
    // Ask in a scattered order, so checkpoints are used from both sides.
    const starts = [...expected.keys()];
    const order = starts
      .filter((_, i) => i % 97 === 0)
      .reverse()
      .concat(starts.filter((_, i) => i % 13 === 0));
    for (const pos of order) expect(cache.stateAt(pos)).toEqual(expected.get(pos));
  });

  it("is inside a quote, in the right column, after a line break inside a quoted field", () => {
    const text = 'a,b,"x\ny\nz",c\nnext\n';
    const cache = new ScanCache(Text.of(text.split("\n")), ",");
    expect(cache.stateAt(text.indexOf("y"))).toEqual({ inQuote: true, col: 2 });
    expect(cache.stateAt(text.indexOf("z"))).toEqual({ inQuote: true, col: 2 });
    expect(cache.stateAt(text.indexOf("next"))).toEqual({ inQuote: false, col: 0 });
  });

  it("reads forward from the nearest checkpoint instead of from the top", () => {
    const text = sample(20_000);
    const doc = Text.of(text.split("\n"));
    const cache = new ScanCache(doc, ",");
    const target = doc.line(doc.lines - 100).from;
    cache.stateAt(target);
    const cold = cache.scanned;
    expect(cold).toBeGreaterThan(0);
    expect(cache.checkpointCount).toBeGreaterThan(5);
    // Scrolling a little reads little.
    cache.stateAt(doc.line(doc.lines - 50).from);
    expect(cache.scanned - cold).toBeLessThan(70_000);
    // Asking again reads nothing.
    const warm = cache.scanned;
    cache.stateAt(target);
    expect(cache.scanned).toBe(warm);
  });

  it("keeps checkpoints before an edit and drops those after it", () => {
    const text = sample(20_000);
    const doc = Text.of(text.split("\n"));
    const cache = new ScanCache(doc, ",");
    cache.stateAt(doc.line(doc.lines - 10).from);
    const state = EditorState.create({ doc });
    const editAt = Math.floor(doc.length / 2);
    const edited = state.update({ changes: { from: editAt, insert: '"' } }).state.doc;
    const next = cache.after(edited, editAt);
    expect(next.checkpointCount).toBeGreaterThan(1);
    expect(next.checkpointCount).toBeLessThan(cache.checkpointCount);
    // And it is right for the edited text.
    const expected = lineStates(edited.toString(), ",");
    const at = edited.line(edited.lines - 10).from;
    expect(next.stateAt(at)).toEqual(expected.get(at));
  });
});

describe("csvColumns", () => {
  function viewFor(text: string, setting = "auto", path: string | null = "/a.csv"): EditorView {
    const parent = document.createElement("div");
    document.body.append(parent);
    return new EditorView({
      state: EditorState.create({ doc: text, extensions: [csvColumns(setting, path)] }),
      parent,
    });
  }

  /** Column class by field text, from the decorations on the first lines. */
  function classes(view: EditorView): Map<string, string> {
    const out = new Map<string, string>();
    for (const el of Array.from(view.contentDOM.querySelectorAll("[class*='cm-csv-']"))) {
      out.set(
        el.textContent ?? "",
        Array.from(el.classList).find((c) => c.startsWith("cm-csv-")) ?? "",
      );
    }
    return out;
  }

  it("gives each column its own hue and dims the delimiters", () => {
    const view = viewFor("a,b,c\n1,2,3\n");
    const found = classes(view);
    expect(found.get("a")).toBe("cm-csv-c0");
    expect(found.get("b")).toBe("cm-csv-c1");
    expect(found.get("3")).toBe("cm-csv-c2");
    expect(view.contentDOM.querySelectorAll(".cm-csv-delim").length).toBe(4);
    view.destroy();
  });

  it("wraps around after the last hue", () => {
    const row = Array.from({ length: COLUMN_HUES + 2 }, (_, i) => `f${i}`).join(",");
    const view = viewFor(row + "\n");
    const found = classes(view);
    expect(found.get(`f${COLUMN_HUES}`)).toBe("cm-csv-c0");
    view.destroy();
  });

  it("uses the delimiter setting, and tab for a .tsv under auto", () => {
    const semi = viewFor("a;b\n1;2\n", "semicolon");
    expect(classes(semi).get("b")).toBe("cm-csv-c1");
    semi.destroy();
    const tsv = viewFor("a,x\tb\n", "auto", "/a.tsv");
    expect(classes(tsv).get("b")).toBe("cm-csv-c1");
    tsv.destroy();
  });

  it("colours a quoted field that spans lines as one column", () => {
    const view = viewFor('a,"b\nstill b",c\n');
    const found = classes(view);
    // One mark, drawn as one span per line.
    expect(found.get('"b')).toBe("cm-csv-c1");
    expect(found.get('still b"')).toBe("cm-csv-c1");
    expect(found.get("c")).toBe("cm-csv-c2");
    view.destroy();
  });

  it("does not change the text", () => {
    const text = 'a,"b\nc",d\ne;f\n';
    const view = viewFor(text);
    expect(view.state.doc.toString()).toBe(text);
    view.destroy();
  });

  it("keeps working after edits", () => {
    const view = viewFor("a,b\n");
    view.dispatch({ changes: { from: 0, insert: '"' } });
    // The quote now opens a field that never closes: one field, one column.
    expect(classes(view).get('"a,b')).toBe("cm-csv-c0");
    view.destroy();
  });

  it("does not bind Tab", () => {
    const view = viewFor("a,b\n");
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    view.destroy();
  });

  it("colours nothing above 5 MB", () => {
    const line = "a,b,c,d,e,f,g,h\n";
    const view = viewFor(line.repeat(Math.ceil(5_100_000 / line.length)));
    expect(view.contentDOM.querySelector("[class*='cm-csv-']")).toBeNull();
    view.destroy();
  });
});
