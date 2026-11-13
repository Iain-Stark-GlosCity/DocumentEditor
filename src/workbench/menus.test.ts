import { describe, expect, it } from "vitest";
import { CommandRegistry } from "../core/commands";
import { buildMenus } from "./menus";

function registry(...ids: string[]): CommandRegistry {
  const r = new CommandRegistry();
  for (const id of ids)
    r.register({ id, title: `Title ${id}`, defaultKey: "Mod-x", run: () => {} });
  return r;
}

describe("buildMenus", () => {
  it("orders known menus, puts custom ones before Help and skips missing commands", () => {
    const commands = registry("a", "b", "c", "d");
    const menus = buildMenus(
      [
        { menu: "help", group: "1", command: "a" },
        { menu: "tools", group: "1", command: "b" },
        { menu: "view", group: "1", command: "c" },
        { menu: "file", group: "1", command: "d" },
        { menu: "file", group: "1", command: "missing" },
      ],
      commands,
    );
    expect(menus.map((m) => m.id)).toEqual(["file", "view", "tools", "help"]);
    expect(menus.map((m) => m.label)).toEqual(["File", "View", "Tools", "Help"]);
    expect(menus[0]?.groups[0]).toHaveLength(1);
  });

  it("sorts groups by name then items by order, with labels and keys", () => {
    const commands = registry("a", "b", "c");
    const [file] = buildMenus(
      [
        { menu: "file", group: "2_x", command: "a" },
        { menu: "file", group: "1_x", command: "b", order: 5 },
        { menu: "file", group: "1_x", command: "c", order: 1, label: "Custom" },
      ],
      commands,
    );
    expect(file?.groups.map((g) => g.map((e) => e.label))).toEqual([
      ["Custom", "Title b"],
      ["Title a"],
    ]);
    expect(file?.groups[0]?.[0]?.keys).toBe("Ctrl+X");
  });
});
