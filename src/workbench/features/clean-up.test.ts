import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readZip } from "../../core/archive";
import type { TextFormatProvider } from "../../core/format";
import type { RepairPlan } from "../../core/repair";
import { FormatRegistry } from "../../core/registry";
import { decodePartText } from "../../core/text-codec";
import { ContainerPlatform } from "../../platform/containers";
import { MemoryPlatform } from "../../platform/memory";
import { Workbench } from "../workbench";
import { CLEAN_UP_COMMAND, cleanUp, cleanUpFeature } from "./clean-up";
import { externalChanges } from "./external-changes";

const DOCX = "C:\\docs\\report.docx";
const PART = `${DOCX}!/word/document.xml`;
const STYLES = `${DOCX}!/word/styles.xml`;
const SECRET = "Jane Secret";
const DOC = (word: string) =>
  `<?xml version="1.0"?>\n<w:document xmlns:w="urn:w"><w:p author="${SECRET}">${word}</w:p></w:document>`;

const partText = (bytes: Uint8Array, part: string) =>
  decodePartText(readZip(bytes).bytes(part)).text;

function docx(word = "old"): Uint8Array {
  const enc = (t: string) => new TextEncoder().encode(t);
  return zipSync(
    {
      "[Content_Types].xml": enc("<Types/>"),
      "word/document.xml": enc(DOC(word)),
      "word/styles.xml": enc("<styles/>"),
    },
    { mtime: new Date(2024, 0, 1) },
  );
}

/** What the fake format's repair does, and how it can be made to fail. */
const behaviour = {
  offersFail: false,
  planFail: false,
  /** Text the plan's lines carry, to prove it is shown as given (the format must keep it plain). */
  details: ["word/document.xml: changes 1 word"],
};

const fakeDocx: TextFormatProvider = {
  kind: "text",
  id: "docx",
  name: "Word document",
  fileExtensions: ["docx"],
  viewModes: ["source"],
  readOnly: true,
  editorExtensions: () => [],
  binary: {
    archive: "zip",
    // The view shows the main part, so a stale view is easy to see.
    decode: async (bytes) => `view: ${partText(bytes, "word/document.xml")}`,
    repairs: {
      async offers(bytes) {
        if (behaviour.offersFail) throw new Error("The worker stopped");
        return partText(bytes, "word/document.xml").includes(">old<")
          ? [{ id: "fake.fix", title: "Fix the word", summary: "1 word" }]
          : [];
      },
      async plan(bytes, { id }): Promise<RepairPlan | null> {
        if (behaviour.planFail) throw new Error("The worker stopped");
        const text = partText(bytes, "word/document.xml");
        if (!text.includes(">old<")) return null;
        return {
          id,
          title: "Fix the word",
          changes: [{ part: "word/document.xml", text: text.replace(">old<", ">new<") }],
          details: behaviour.details,
          skipped: [],
        };
      },
    },
  },
};

const xmlFake: TextFormatProvider = {
  kind: "text",
  id: "xml",
  name: "XML",
  fileExtensions: ["xml"],
  viewModes: ["source"],
  editorExtensions: () => [],
};

let memory: MemoryPlatform;
let wb: Workbench;

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const messages = () => wb.ui.getState().notifications.map((n) => n.message);
const disk = () => memory.binaryFiles.get(DOCX)!;
const docOf = (path: string) => wb.documents.getState().documents.find((d) => d.path === path)!;

async function boot(open: string[]) {
  vi.useFakeTimers();
  const registry = new FormatRegistry();
  registry.register(fakeDocx);
  registry.register(xmlFake, { default: true, fallback: true });
  memory = new MemoryPlatform();
  memory.seedBinary(DOCX, docx());
  wb = new Workbench({
    platform: new ContainerPlatform(memory, registry),
    registry,
    features: [cleanUpFeature, externalChanges],
    settingsSaveDelayMs: 5,
  });
  wb.start();
  await wb.openPaths(open);
  await settle(10);
}

/** Answers the pick with `pick` (null dismisses it) and the dialog with `answer`. */
async function run(pick: string | null, answer?: string): Promise<boolean> {
  const done = cleanUp(wb);
  await settle();
  const pending = wb.ui.getState().pick;
  if (pending) wb.resolvePick(pending.id, pick);
  await settle();
  if (answer !== undefined) {
    const dialog = wb.ui.getState().dialogs[0];
    if (!dialog) throw new Error("no dialog");
    wb.resolveDialog(dialog.id, answer);
  }
  await settle();
  return done;
}

beforeEach(() => {
  behaviour.offersFail = false;
  behaviour.planFail = false;
  behaviour.details = ["word/document.xml: changes 1 word"];
});

afterEach(() => {
  wb.dispose();
  vi.useRealTimers();
});

describe("Clean up this file", () => {
  it("is a registered command, enabled for a container view or one of its parts", async () => {
    await boot([DOCX]);
    expect(wb.commands.get(CLEAN_UP_COMMAND)?.title).toBe("Clean up this file…");
    expect(wb.commands.get(CLEAN_UP_COMMAND)?.enabled?.()).toBe(true);
  });

  it("applies the plan; open views and clean part tabs show the new text at once, without a 'changed on disk' message", async () => {
    await boot([DOCX, PART, STYLES]);
    const stylesToken = docOf(STYLES).modifiedMs;
    expect(await run("fake.fix", "apply")).toBe(true);
    expect(partText(disk(), "word/document.xml")).toContain(">new<");
    expect(memory.binaryFiles.has(`${DOCX}.bak`)).toBe(true);
    // Without waiting for a file-system event.
    expect(wb.getText(docOf(PART).id)).toContain(">new<");
    expect(wb.isDirty(docOf(PART).id)).toBe(false);
    expect(wb.getText(docOf(DOCX).id)).toContain("view: ");
    expect(wb.getText(docOf(DOCX).id)).toContain(">new<");
    expect(docOf(STYLES).modifiedMs).toBe(stylesToken);
    // The desktop watcher then reports the app's own write: nothing to reload, nothing to say.
    memory.triggerFileChange(DOCX);
    await settle(1000);
    expect(messages().filter((m) => /changed on disk/.test(m))).toEqual([]);
    expect(wb.ui.getState().dialogs).toEqual([]);
    expect(messages().at(-1)).toBe("Fix the word: done. report.docx was saved.");
  });

  it("refuses while a part has unsaved edits, and writes nothing", async () => {
    await boot([DOCX, STYLES]);
    const before = disk();
    wb.replaceText(docOf(STYLES).id, "<styles><x/></styles>");
    expect(await run("fake.fix")).toBe(false);
    expect(disk()).toEqual(before);
    expect(messages().at(-1)).toMatch(/^Save or close report\.docx › styles\.xml first/);
  });

  it("refuses when a part is edited while the confirmation is open", async () => {
    await boot([DOCX, STYLES]);
    const before = disk();
    const done = cleanUp(wb);
    await settle();
    wb.resolvePick(wb.ui.getState().pick!.id, "fake.fix");
    await settle();
    wb.replaceText(docOf(STYLES).id, "<styles><x/></styles>");
    wb.resolveDialog(wb.ui.getState().dialogs[0]!.id, "apply");
    expect(await done).toBe(false);
    expect(disk()).toEqual(before);
    expect(messages().at(-1)).toMatch(/Nothing was changed\.$/);
  });

  it("refuses when the file changed on disk after the plan was made", async () => {
    await boot([DOCX]);
    const done = cleanUp(wb);
    await settle();
    wb.resolvePick(wb.ui.getState().pick!.id, "fake.fix");
    await settle();
    memory.seedBinary(DOCX, docx("old "));
    const changed = disk();
    wb.resolveDialog(wb.ui.getState().dialogs[0]!.id, "apply");
    expect(await done).toBe(false);
    expect(disk()).toEqual(changed);
    expect(messages().at(-1)).toMatch(/has changed since this change was prepared/);
  });

  it("two clean-ups at once: the second is refused, not applied over the first", async () => {
    await boot([DOCX]);
    const first = cleanUp(wb);
    await settle();
    wb.resolvePick(wb.ui.getState().pick!.id, "fake.fix");
    await settle();
    const second = cleanUp(wb);
    await settle();
    wb.resolvePick(wb.ui.getState().pick!.id, "fake.fix");
    await settle();
    const [a, b] = wb.ui.getState().dialogs;
    wb.resolveDialog(a!.id, "apply");
    await settle();
    wb.resolveDialog(b!.id, "apply");
    expect([await first, await second]).toEqual([true, false]);
    expect(partText(disk(), "word/document.xml")).toBe(DOC("new"));
  });

  it("Cancel at the pick or at the confirmation (and Escape, its cancel value) changes nothing", async () => {
    await boot([DOCX]);
    const before = disk();
    expect(await run(null)).toBe(false);
    expect(await run("fake.fix", "cancel")).toBe(false);
    expect(disk()).toEqual(before);
    expect(memory.binaryFiles.has(`${DOCX}.bak`)).toBe(false);
  });

  it("the confirmation starts on Cancel, names the backup and lists the plan", async () => {
    await boot([DOCX]);
    const done = cleanUp(wb);
    await settle();
    wb.resolvePick(wb.ui.getState().pick!.id, "fake.fix");
    await settle();
    const dialog = wb.ui.getState().dialogs[0]!;
    expect(dialog.initialFocus).toBe("cancel");
    expect(dialog.cancelValue).toBe("cancel");
    expect(dialog.message).toContain("word/document.xml: changes 1 word");
    expect(dialog.message).toContain("report.docx.bak");
    wb.resolveDialog(dialog.id, "cancel");
    await done;
  });

  it("a failing worker or a failed write gives a plain message and writes nothing", async () => {
    await boot([DOCX]);
    const before = disk();
    behaviour.offersFail = true;
    expect(await run("fake.fix")).toBe(false);
    expect(messages().at(-1)).toBe("Could not check report.docx: The worker stopped");
    behaviour.offersFail = false;
    behaviour.planFail = true;
    expect(await run("fake.fix")).toBe(false);
    expect(messages().at(-1)).toBe("Could not prepare that clean-up: The worker stopped");
    behaviour.planFail = false;
    // The file cannot be written (read-only on disk): the backup copy is refused first.
    memory.failNextBinaryWrite = new Error("Access is denied");
    expect(await run("fake.fix", "apply")).toBe(false);
    expect(messages().at(-1)).toMatch(/^Could not apply the clean-up: .*Access is denied/);
    expect(disk()).toEqual(before);
  });

  it("no message shows document text", async () => {
    await boot([DOCX, PART]);
    await run("fake.fix", "apply");
    await run(null);
    for (const m of messages()) expect(m).not.toContain(SECRET);
  });
});
