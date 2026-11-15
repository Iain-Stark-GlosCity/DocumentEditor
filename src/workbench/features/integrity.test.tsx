import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Finding } from "../../core/findings";
import type { TextFormatProvider } from "../../core/format";
import { FormatRegistry } from "../../core/registry";
import { SETTINGS_SCHEMA } from "../../core/settings";
import { MemoryPlatform } from "../../platform/memory";
import type { ContainerAccess } from "../../platform/platform";
import { App } from "../App";
import {
  DOCUMENT_XML,
  DOCX,
  docxViewFake,
  fakeContainers,
  markdownFake,
  textFake,
  xmlFake,
  VIEW_TEXT,
} from "../container-test-helpers";
import { defaultFeatures } from "./index";
import { integrityController } from "./integrity-controller";
import { Workbench } from "../workbench";
import { editorView, pressKey } from "../test-helpers";

const NOTE = "C:\\docs\\note.md";
const SECRET_TITLE = "Style Quarterly Secret is missing";
const SECRET_WHY = "Word may drop the secret formatting.";

function finding(over: Partial<Finding> & { id: string }): Finding {
  return {
    rule: "package.example",
    severity: "warning",
    family: "package",
    title: `Title ${over.id}`,
    why: `Why ${over.id}`,
    locations: [],
    ...over,
  };
}

const FINDINGS: Finding[] = [
  finding({
    id: "n1",
    severity: "info",
    family: "formatting",
    rule: "formatting.note",
    title: "A note",
  }),
  finding({
    id: "w1",
    severity: "warning",
    family: "styles",
    rule: "styles.unused",
    title: "Unused style",
  }),
  finding({
    id: "e1",
    severity: "error",
    family: "package",
    rule: "package.relationship-target-missing",
    title: SECRET_TITLE,
    why: SECRET_WHY,
    facts: { count: 2, id: "rId7" },
    locations: [
      {
        part: "word/_rels/document.xml.rels",
        locator: "/Relationships/Relationship[3]",
        label: "relationship 3",
      },
      { part: "word/document.xml", locator: "/w:document/w:body/w:p[12]" },
    ],
  }),
  finding({
    id: "e2",
    severity: "error",
    family: "package",
    rule: "package.other",
    title: "Second error",
  }),
  finding({
    id: "n2",
    severity: "info",
    family: "package",
    rule: "package.note",
    title: "Package note",
  }),
];

interface Fake {
  results: (Finding[] | Error)[];
  calls: { path: string }[];
  /** When set, the next inspect call waits for this promise. */
  gate: Promise<void> | null;
}

function inspectingFormat(fake: Fake): TextFormatProvider {
  return {
    ...docxViewFake,
    binary: {
      archive: "zip",
      decode: () => Promise.resolve(VIEW_TEXT),
      async inspect(_bytes, context) {
        fake.calls.push({ path: context.path });
        const result = fake.results.length > 1 ? fake.results.shift() : fake.results[0];
        const gate = fake.gate;
        fake.gate = null;
        if (gate) await gate;
        if (result instanceof Error) throw result;
        return result ?? [];
      },
    },
  };
}

async function setup(
  results: (Finding[] | Error)[] = [FINDINGS],
  options: { visible?: boolean; gate?: Promise<void> } = {},
) {
  const fake: Fake = { results, calls: [], gate: options.gate ?? null };
  const platform = new MemoryPlatform();
  platform.seedFile(DOCX, VIEW_TEXT);
  platform.seedFile(DOCUMENT_XML, "<w:document><w:body/></w:document>\n");
  platform.seedFile(NOTE, "# Note\n");
  platform.seedBinary(DOCX, [1, 2, 3]);
  (platform as { containers?: ContainerAccess }).containers = fakeContainers();
  const registry = new FormatRegistry();
  registry.register(markdownFake, { default: true });
  registry.register(inspectingFormat(fake));
  registry.register(xmlFake);
  registry.register(textFake, { fallback: true });
  const workbench = new Workbench({
    platform,
    registry,
    features: defaultFeatures,
    settingsSaveDelayMs: 5,
  });
  render(<App workbench={workbench} />);
  await act(async () => {
    await workbench.ready;
    if (options.visible !== false) workbench.settings.set("integrity.visible", true);
    await workbench.openPaths([DOCX]);
  });
  return { fake, platform, workbench };
}

const region = () => screen.getByRole("region", { name: "Integrity" });
const tree = () => screen.getByRole("tree", { name: "Findings" });
const rowNames = () =>
  within(tree())
    .getAllByRole("treeitem")
    .map((e) => e.getAttribute("aria-label") ?? e.textContent);
const row = (title: string | RegExp) => within(tree()).getByRole("treeitem", { name: title });
const key = (target: Element, k: string) => fireEvent.keyDown(target, { key: k });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Integrity pane", () => {
  it("is off by default and the setting exists", async () => {
    expect(SETTINGS_SCHEMA["integrity.visible"].default).toBe(false);
    const { fake } = await setup([FINDINGS], { visible: false });
    expect(screen.queryByRole("region", { name: "Integrity" })).toBeNull();
    // Hidden means no reading of the file either.
    expect(fake.calls).toHaveLength(0);
  });

  it("shows only for a container whose format can inspect it", async () => {
    const { workbench } = await setup();
    await screen.findByRole("tree", { name: "Findings" });
    await act(async () => void (await workbench.openPaths([NOTE])));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Integrity" })).toBeNull());
  });

  it("does not show for a container format without inspect", async () => {
    const platform = new MemoryPlatform();
    platform.seedFile(DOCX, VIEW_TEXT);
    (platform as { containers?: ContainerAccess }).containers = fakeContainers();
    const registry = new FormatRegistry();
    registry.register(markdownFake, { default: true });
    registry.register(docxViewFake);
    registry.register(textFake, { fallback: true });
    const workbench = new Workbench({
      platform,
      registry,
      features: defaultFeatures,
      settingsSaveDelayMs: 5,
    });
    render(<App workbench={workbench} />);
    await act(async () => {
      await workbench.ready;
      workbench.settings.set("integrity.visible", true);
      await workbench.openPaths([DOCX]);
    });
    expect(screen.queryByRole("region", { name: "Integrity" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Integrity/ })).toBeNull();
  });

  it("shows a busy state while running, then the result, reading the container once", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { fake } = await setup([FINDINGS], { gate });
    const status = await screen.findByText("Checking the file…");
    expect(status.getAttribute("role")).toBe("status");
    expect(region().querySelector(".integrity")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => release());
    await screen.findByRole("tree", { name: "Findings" });
    expect(region().querySelector(".integrity")?.getAttribute("aria-busy")).toBe("false");
    expect(fake.calls).toEqual([{ path: DOCX }]);
  });

  it("shows the error message when the check fails, and recovers with Check again", async () => {
    const { fake } = await setup([new Error("Zip is damaged")]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Zip is damaged");
    fake.results = [FINDINGS];
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByRole("tree", { name: "Findings" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so when nothing is found, honestly", async () => {
    await setup([[]]);
    await screen.findByText(/^No problems found\./);
    expect(region().textContent).toContain(
      "No problems found. This checks the file's structure against the rules listed in the documentation; it does not prove that Word will open the file.",
    );
    expect(screen.getByRole("button", { name: /Integrity: no problems/ })).toBeTruthy();
  });

  it("groups by family with errors first, and shows severity as a word and a count of locations", async () => {
    await setup();
    await screen.findByRole("tree", { name: "Findings" });
    const groups = within(tree())
      .getAllByRole("treeitem", { expanded: true })
      .filter((e) => e.getAttribute("aria-level") === "1");
    expect(groups.map((g) => g.querySelector(".integrity-group-name")?.textContent)).toEqual([
      "package",
      "styles",
      "formatting",
    ]);
    expect(rowNames()).toEqual([
      expect.stringMatching(/^package, /),
      "Error: Second error, 0 locations",
      `Error: ${SECRET_TITLE}, 2 locations`,
      "Note: Package note, 0 locations",
      expect.stringMatching(/^styles, /),
      "Warning: Unused style, 0 locations",
      expect.stringMatching(/^formatting, /),
      "Note: A note, 0 locations",
    ]);
    expect(row(/^Error: Style/).textContent).toContain("Error");
    expect(row(/^Warning/).textContent).toContain("Warning");
  });

  it("collapses a group", async () => {
    await setup();
    await screen.findByRole("tree", { name: "Findings" });
    fireEvent.click(within(tree()).getByRole("treeitem", { name: /^styles, / }));
    expect(screen.queryByRole("treeitem", { name: /Unused style/ })).toBeNull();
    fireEvent.click(within(tree()).getByRole("treeitem", { name: /^styles, / }));
    expect(screen.getByRole("treeitem", { name: /Unused style/ })).toBeTruthy();
  });

  it("filters by severity with live counts, using aria-pressed toggles", async () => {
    await setup();
    await screen.findByRole("tree", { name: "Findings" });
    const errors = within(region()).getByRole("button", { name: /2 errors/ });
    expect(within(region()).getByRole("button", { name: /1 warning$/ })).toBeTruthy();
    expect(within(region()).getByRole("button", { name: /2 notes/ })).toBeTruthy();
    expect(errors.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(errors);
    expect(errors.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("treeitem", { name: /Second error/ })).toBeNull();
    expect(screen.getByRole("treeitem", { name: /Unused style/ })).toBeTruthy();
    fireEvent.click(within(region()).getByRole("button", { name: /1 warning$/ }));
    fireEvent.click(within(region()).getByRole("button", { name: /2 notes/ }));
    expect(screen.getByText("No findings match the filters.")).toBeTruthy();
  });

  it("filters by text across title, rule and location", async () => {
    await setup();
    await screen.findByRole("tree", { name: "Findings" });
    const box = screen.getByRole("searchbox", { name: "Filter findings" });
    fireEvent.change(box, { target: { value: "unused" } });
    expect(rowNames().filter((n) => n.startsWith("Warning"))).toHaveLength(1);
    expect(screen.queryByRole("treeitem", { name: /Second error/ })).toBeNull();
    fireEvent.change(box, { target: { value: "w:p[12]" } });
    expect(screen.getByRole("treeitem", { name: /Style Quarterly/ })).toBeTruthy();
  });

  it("expands a finding to show why, facts and locations, and reveals the right path and locator", async () => {
    const { workbench } = await setup();
    await screen.findByRole("tree", { name: "Findings" });
    const reveal = vi.spyOn(workbench, "revealPart").mockResolvedValue(true);
    const target = row(/Style Quarterly/);
    expect(target.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(target);
    expect(target.getAttribute("aria-expanded")).toBe("true");
    const details = screen.getByRole("group", { name: /Details of/ });
    expect(details.textContent).toContain(SECRET_WHY);
    expect(within(details).getByText("rId7")).toBeTruthy();
    expect(details.querySelectorAll("dt")).toHaveLength(2);

    fireEvent.click(
      within(details).getByRole("button", {
        name: /word\/_rels\/document\.xml\.rels relationship 3/,
      }),
    );
    expect(reveal).toHaveBeenLastCalledWith(
      `${DOCX}!/word/_rels/document.xml.rels`,
      "/Relationships/Relationship[3]",
    );
    fireEvent.click(
      within(details).getByRole("button", { name: /word\/document\.xml \/w:document/ }),
    );
    expect(reveal).toHaveBeenLastCalledWith(
      `${DOCX}!/word/document.xml`,
      "/w:document/w:body/w:p[12]",
    );
  });

  it("shows just the explanation for a finding with no locations", async () => {
    await setup();
    await screen.findByRole("tree", { name: "Findings" });
    fireEvent.click(row(/Second error/));
    const details = screen.getByRole("group", { name: /Details of Second error/ });
    expect(details.textContent).toContain("Why e2");
    expect(within(details).queryAllByRole("button")).toHaveLength(0);
  });

  it("is operable by keyboard with a roving tabindex", async () => {
    await setup();
    await screen.findByRole("tree", { name: "Findings" });
    const items = () => within(tree()).getAllByRole("treeitem");
    expect(items().filter((i) => i.tabIndex === 0)).toHaveLength(1);
    const first = items()[0] as HTMLElement;
    first.focus();
    key(first, "ArrowDown");
    const second = items()[1] as HTMLElement;
    expect(document.activeElement).toBe(second);
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);
    key(second, "ArrowDown");
    // The third row is the finding that has locations.
    const third = items()[2] as HTMLElement;
    expect(document.activeElement).toBe(third);
    key(third, "Enter");
    expect(third.getAttribute("aria-expanded")).toBe("true");
    key(third, "ArrowRight");
    expect((document.activeElement as HTMLElement).className).toContain("integrity-location");
    key(document.activeElement as Element, "Escape");
    expect(document.activeElement).toBe(third);
    key(third, "ArrowLeft");
    expect(third.getAttribute("aria-expanded")).toBe("false");
    key(third, "ArrowLeft");
    expect(document.activeElement).toBe(items()[0]);
    key(items()[0] as Element, "End");
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe(
      "Note: A note, 0 locations",
    );
    key(document.activeElement as Element, "Home");
    expect(document.activeElement).toBe(items()[0]);
  });

  it("ignores a stale run when a newer one finishes first", async () => {
    let releaseFirst: () => void = () => undefined;
    const first = new Promise<void>((resolve) => (releaseFirst = resolve));
    const { fake, workbench } = await setup(
      [
        [finding({ id: "old", title: "Old result" })],
        [finding({ id: "new", title: "New result" })],
      ],
      { gate: first },
    );
    await screen.findByText("Checking the file…");
    // Run again while the first is still waiting (the button is disabled, so use the command).
    await act(async () => void (await integrityController(workbench).run()));
    await screen.findByRole("treeitem", { name: /New result/ });
    await act(async () => releaseFirst());
    expect(screen.queryByRole("treeitem", { name: /Old result/ })).toBeNull();
    expect(screen.getByRole("treeitem", { name: /New result/ })).toBeTruthy();
    expect(fake.calls).toHaveLength(2);
  });

  it("checks again after a part of the container is saved, once, after a pause", async () => {
    const { fake, workbench } = await setup([
      [finding({ id: "a", title: "First" })],
      [finding({ id: "b", title: "Second" })],
    ]);
    await screen.findByRole("treeitem", { name: /First/ });
    await act(async () => void (await workbench.openPaths([DOCUMENT_XML])));
    await waitFor(() => expect(workbench.activeDocument()?.path).toBe(DOCUMENT_XML));
    // Switching to a part of the same container does not read the file again.
    expect(fake.calls).toHaveLength(1);
    const view = editorView();
    act(() => view.dispatch({ changes: { from: 0, insert: " " } }));
    act(() => view.dispatch({ changes: { from: 0, insert: " " } }));
    expect(fake.calls).toHaveLength(1);
    await act(async () => void (await workbench.save()));
    expect(fake.calls).toHaveLength(1);
    await waitFor(() => expect(fake.calls).toHaveLength(2), { timeout: 4000 });
    await screen.findByRole("treeitem", { name: /Second/ });
  });

  it("checks again when the container changes on disk", async () => {
    const { fake, platform } = await setup([
      [finding({ id: "a", title: "First" })],
      [finding({ id: "b", title: "Second" })],
    ]);
    await screen.findByRole("treeitem", { name: /First/ });
    act(() => platform.triggerFileChange(DOCX));
    await waitFor(() => expect(fake.calls).toHaveLength(2), { timeout: 4000 });
    await screen.findByRole("treeitem", { name: /Second/ });
  });

  it("copies a report with rule codes and locations but none of the text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await setup();
    await screen.findByRole("tree", { name: "Findings" });
    const button = screen.getByRole("button", { name: "Copy report" });
    expect(button.getAttribute("title")).toMatch(/none of the document's text/);
    const help = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(help?.textContent).toMatch(/rule codes, counts and locations/);
    fireEvent.click(button);
    await screen.findByText("Report copied");
    const text = String(writeText.mock.calls[0]?.[0]);
    expect(text).toContain("package.relationship-target-missing");
    expect(text).toContain("word/document.xml /w:document/w:body/w:p[12]");
    expect(text).not.toContain(SECRET_TITLE);
    expect(text).not.toContain(SECRET_WHY);
  });

  it("notifies when the clipboard cannot be written", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
      configurable: true,
    });
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    const { workbench } = await setup();
    await screen.findByRole("tree", { name: "Findings" });
    fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    await waitFor(() =>
      expect(workbench.ui.getState().notifications.map((n) => n.message)).toContain(
        "Could not copy the integrity report.",
      ),
    );
    expect(screen.queryByText("Report copied")).toBeNull();
  });

  it("shows a status item that opens the pane", async () => {
    const { workbench } = await setup([FINDINGS], { visible: false });
    expect(screen.queryByRole("button", { name: /^Integrity/ })).toBeNull();
    await act(async () => void (await workbench.runCommand("view.checkIntegrity")));
    const status = await screen.findByRole("button", {
      name: /Integrity: 2 errors, 1 warning, 2 notes/,
    });
    expect(status.textContent).toBe("Integrity: 2 errors, 1 warning, 2 notes");
    act(() => workbench.settings.set("integrity.visible", false));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Integrity" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Integrity: 2 errors/ }));
    expect(workbench.settings.get("integrity.visible")).toBe(true);
    expect(await screen.findByRole("region", { name: "Integrity" })).toBeTruthy();
  });

  it("has a toggle command, a ticked menu item and a check command that runs the check", async () => {
    const { workbench, fake } = await setup([FINDINGS], { visible: false });
    expect(workbench.commands.get("view.toggleIntegrity")?.title).toBe("Document integrity");
    expect(workbench.commands.get("view.checkIntegrity")?.title).toBe("Check document integrity");
    pressKey("i", { altKey: true });
    await screen.findByRole("tree", { name: "Findings" });
    expect(workbench.settings.get("integrity.visible")).toBe(true);
    expect(fake.calls).toHaveLength(1);
    await act(async () => void (await workbench.runCommand("view.checkIntegrity")));
    expect(fake.calls).toHaveLength(2);
    await act(async () => void (await workbench.runCommand("view.toggleIntegrity")));
    expect(workbench.settings.get("integrity.visible")).toBe(false);
  });

  it("works beside the Parts pane and the outline, with its own saved size", async () => {
    const { workbench } = await setup();
    await screen.findByRole("tree", { name: "Findings" });
    act(() => workbench.settings.set("outline.visible", true));
    expect(await screen.findByRole("region", { name: "Outline" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Parts" })).toBeTruthy();
    expect(region()).toBeTruthy();
    const splitter = screen.getByRole("separator", { name: "Resize integrity" });
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(workbench.settings.get("ui.paneSizes").integrity).toBe(30);
    expect(workbench.settings.get("ui.paneSizes").parts).toBeUndefined();
  });
});
