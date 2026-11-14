import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import type { FormatCommand } from "../../core/format";
import { problemStatusOf } from "../../core/problems";
import { jsonProvider } from ".";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function editor(text: string, path: string, settings: Record<string, unknown> = {}): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        jsonProvider.editorExtensions({
          mode: "source",
          path,
          setting: <T>(key: string, fallback: T) => (settings[key] as T | undefined) ?? fallback,
        }),
      ],
    }),
  });
  views.push(view);
  return view;
}

const command = (id: string): FormatCommand => {
  const found = jsonProvider.commands?.find((c) => c.id === id);
  if (!found) throw new Error(`No command ${id}`);
  return found;
};

describe("JSON provider", () => {
  it("claims the JSON extensions, is source only and turns spellcheck off", () => {
    expect(jsonProvider.fileExtensions).toEqual(["json", "jsonc", "geojson"]);
    expect(jsonProvider.viewModes).toEqual(["source"]);
    expect(jsonProvider.spellcheck).toBe(false);
  });

  it("declares the two commands, and a toolbar that names only them", () => {
    expect(jsonProvider.commands?.map((c) => [c.id, c.title, c.defaultKey])).toEqual([
      ["json.format", "Format document", "Shift-Alt-f"],
      ["json.minify", "Minify", undefined],
    ]);
    const used = jsonProvider.toolbar?.flatMap((g) =>
      g.items.flatMap((i) => ("command" in i ? [i.command] : [])),
    );
    expect(used).toEqual(["json.format", "json.minify"]);
  });

  it("formats in one undoable transaction and keeps the text outside the change", () => {
    const view = editor('{"a":1,"b":[1,2]}', "/x/a.json");
    expect(command("json.format").run(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('{"a":1,"b":[1,2]}');
    expect(undo(view)).toBe(false);
  });

  it("minifies, and uses the json.indent setting for format", () => {
    const view = editor('{\n  "a": 1\n}\n', "/x/a.json", { "json.indent": 4 });
    expect(command("json.minify").run(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('{"a":1}\n');
    expect(command("json.format").run(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('{\n    "a": 1\n}\n');
  });

  it("declines text with a syntax error, leaving the document and history alone", () => {
    const view = editor('{"a":1,}', "/x/a.json");
    expect(command("json.format").run(view)).toBe(false);
    expect(command("json.minify").run(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('{"a":1,}');
    expect(undo(view)).toBe(false);
  });

  it("allows comments in .jsonc and not in .json", () => {
    const text = '// note\n{"a":1} // end\n';
    const jsonc = editor(text, "/x/a.jsonc");
    expect(command("json.format").run(jsonc)).toBe(true);
    expect(jsonc.state.doc.toString()).toBe('// note\n{\n  "a": 1\n} // end\n');
    const json = editor(text, "/x/a.json");
    expect(command("json.format").run(json)).toBe(false);
  });

  it("returns true and changes nothing when the text is already formatted", () => {
    const text = '{\n  "a": 1\n}\n';
    const view = editor(text, "/x/a.json");
    expect(command("json.format").run(view)).toBe(true);
    expect(undo(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(text);
  });

  it("checks for problems unless json.lint is off", () => {
    expect(problemStatusOf(editor("{}", "/x/a.json").state)).not.toBeNull();
    expect(problemStatusOf(editor("{}", "/x/a.json", { "json.lint": false }).state)).toBeNull();
  });
});
