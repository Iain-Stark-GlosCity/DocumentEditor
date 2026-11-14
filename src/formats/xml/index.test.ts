import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { problemStatusOf } from "../../core/problems";
import { xmlProvider } from ".";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function editor(text: string, settings: Record<string, unknown> = {}): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        xmlProvider.editorExtensions({
          mode: "source",
          path: "/x/a.xml",
          setting: <T>(key: string, fallback: T) => (settings[key] as T | undefined) ?? fallback,
        }),
      ],
    }),
  });
  views.push(view);
  return view;
}

const tidy = (view: EditorView) => xmlProvider.commands?.[0]?.run(view);

describe("XML provider", () => {
  it("claims its extensions, is source only, has no spellcheck", () => {
    expect(xmlProvider.id).toBe("xml");
    expect(xmlProvider.fileExtensions).toEqual(["xml", "rels", "xsd", "xsl", "xslt"]);
    expect(xmlProvider.viewModes).toEqual(["source"]);
    expect(xmlProvider.spellcheck).toBe(false);
  });

  it("declares Tidy and a toolbar that names only it", () => {
    expect(xmlProvider.commands?.map((c) => [c.id, c.title, c.defaultKey])).toEqual([
      ["xml.format", "Tidy", "Shift-Alt-f"],
    ]);
    expect(
      xmlProvider.toolbar?.flatMap((g) => g.items.map((i) => ("command" in i ? i.command : ""))),
    ).toEqual(["xml.format"]);
  });

  it("tidies in one undoable transaction", () => {
    const view = editor("<a><b/></a>");
    expect(tidy(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("<a>\n  <b/>\n</a>");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("<a><b/></a>");
    expect(undo(view)).toBe(false);
  });

  it("uses the xml.indent setting", () => {
    const view = editor("<a><b/></a>", { "xml.indent": 4 });
    tidy(view);
    expect(view.state.doc.toString()).toBe("<a>\n    <b/>\n</a>");
  });

  it("declines text that is not well-formed, changing nothing", () => {
    for (const bad of ["<a><b></a>", "<a>&nope;<b/></a>", "<a b=1><c/></a>"]) {
      const view = editor(bad);
      expect(tidy(view)).toBe(false);
      expect(view.state.doc.toString()).toBe(bad);
      expect(undo(view)).toBe(false);
    }
  });

  it("returns true without a change when already tidy", () => {
    const view = editor("<a>\n  <b/>\n</a>");
    expect(tidy(view)).toBe(true);
    expect(undo(view)).toBe(false);
  });

  it("checks for problems unless xml.lint is off", () => {
    expect(problemStatusOf(editor("<a/>").state)).not.toBeNull();
    expect(problemStatusOf(editor("<a/>", { "xml.lint": false }).state)).toBeNull();
  });
});
