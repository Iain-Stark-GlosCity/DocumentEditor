import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRegistry } from "../../create-registry";
import { problemStatusOf } from "../../core/problems";
import { yamlProvider } from ".";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function editor(text: string, settings: Record<string, unknown> = {}): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: text,
      extensions: yamlProvider.editorExtensions({
        mode: "source",
        path: "/x/a.yaml",
        setting: <T>(key: string, fallback: T) => (settings[key] as T | undefined) ?? fallback,
      }),
    }),
  });
  views.push(view);
  return view;
}

describe("YAML provider", () => {
  it("is registered for .yaml and .yml, source only, with spellcheck off", () => {
    const registry = createRegistry();
    expect(registry.forPath("/a/b.yml")?.id).toBe("yaml");
    expect(registry.forPath("/a/b.YAML")?.id).toBe("yaml");
    expect(yamlProvider.viewModes).toEqual(["source"]);
    expect(yamlProvider.spellcheck).toBe(false);
    expect(yamlProvider.commands).toBeUndefined();
  });

  it("registers JSON for its three extensions", () => {
    const registry = createRegistry();
    for (const ext of ["json", "jsonc", "geojson"]) {
      expect(registry.forPath(`/a/b.${ext}`)?.id).toBe("json");
    }
  });

  it("Tab indents with spaces, never a tab character", async () => {
    const view = editor("a:\n  b: 1\n");
    view.dispatch({ selection: { anchor: 5 } });
    const event = new KeyboardEvent("keydown", { key: "Tab", keyCode: 9 });
    // The editing extensions load on demand; Tab does nothing until they have.
    await vi.waitFor(() => expect(runScopeHandlers(view, event, "editor")).toBe(true));
    expect(view.state.doc.toString()).not.toContain("\t");
    expect(view.state.doc.toString()).toBe("a:\n    b: 1\n");
  });

  it("checks for problems unless yaml.lint is off", () => {
    expect(problemStatusOf(editor("a: 1\n").state)).not.toBeNull();
    expect(problemStatusOf(editor("a: 1\n", { "yaml.lint": false }).state)).toBeNull();
  });
});
