import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryPlatform } from "../../platform/memory";
import type { Workbench } from "../workbench";
import { editorView, renderApp } from "../test-helpers";

async function openEditor(): Promise<{ workbench: Workbench; platform: MemoryPlatform }> {
  const platform = new MemoryPlatform();
  const { workbench } = renderApp({ platform });
  await screen.findByRole("tab", { name: "Untitled-1" });
  return { workbench, platform };
}

const contentAttribute = (name: string) => editorView().contentDOM.getAttribute(name);

describe("spellcheck feature", () => {
  it("enables the platform spellchecker by default, with autocorrect and autocapitalise off", async () => {
    await openEditor();
    expect(contentAttribute("spellcheck")).toBe("true");
    expect(contentAttribute("autocorrect")).toBe("off");
    expect(contentAttribute("autocapitalize")).toBe("off");
  });

  it("edit.toggleSpellcheck turns it off and on again, applied at once", async () => {
    const { workbench } = await openEditor();
    const command = workbench.commands.get("edit.toggleSpellcheck");
    expect(command?.title).toBe("Toggle spellcheck");

    act(() => {
      void command!.run();
    });
    expect(workbench.settings.get("editor.spellcheck")).toBe(false);
    expect(contentAttribute("spellcheck")).toBe("false");

    act(() => {
      void command!.run();
    });
    expect(contentAttribute("spellcheck")).toBe("true");
  });

  it("persists the setting", async () => {
    const { workbench, platform } = await openEditor();
    act(() => {
      void workbench.commands.get("edit.toggleSpellcheck")!.run();
    });
    await waitFor(() => expect(platform.settingsJson).not.toBeNull());
    expect(JSON.parse(platform.settingsJson!)).toEqual({ "editor.spellcheck": false });
  });
});
