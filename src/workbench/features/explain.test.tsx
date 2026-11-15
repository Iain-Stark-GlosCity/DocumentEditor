import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Explanation } from "../../core/explain";
import type { TextFormatProvider } from "../../core/format";
import { FormatRegistry } from "../../core/registry";
import type { SourceMapEntry } from "../../core/source-map";
import { MemoryPlatform } from "../../platform/memory";
import { DEFAULT_FILE_FORMAT, type ContainerAccess } from "../../platform/platform";
import { App } from "../App";
import {
  DOCX,
  docxViewFake,
  fakeContainers,
  markdownFake,
  textFake,
  xmlFake,
} from "../container-test-helpers";
import { editorView } from "../test-helpers";
import { Workbench } from "../workbench";
import { defaultFeatures } from "./index";

const VIEW = "One\nOne b\n\nTwo\n";
const MAP: SourceMapEntry[] = [
  { fromLine: 1, toLine: 2, part: "word/document.xml", locator: "/p[1]" },
  { fromLine: 4, toLine: 4, part: "word/document.xml", locator: "/p[2]" },
];
const PART = `${DOCX}!/word/document.xml`;

function explanation(title: string, withFix = false): Explanation {
  return {
    title,
    notes: [`Note for ${title}`],
    sections: [
      {
        heading: "Layout",
        rows: [
          {
            label: "Left indent",
            value: `${title} indent`,
            source: { label: "Direct formatting", part: "word/document.xml", locator: "/p[1]/ind" },
            overridden: [{ source: { label: "Style Normal" }, value: "0 cm" }],
            ...(withFix
              ? {
                  fix: {
                    label: "Remove this paragraph's own indent",
                    detail: "Deletes the element.",
                    part: "word/document.xml",
                    locator: "/p[1]/ind",
                  },
                }
              : {}),
          },
        ],
      },
    ],
  };
}

interface Call {
  locator: string;
  resolve(value: Explanation | null): void;
  reject(error: Error): void;
}

async function setup(
  options: {
    answer?: (locator: string) => Explanation | null | Promise<Explanation | null>;
    deferred?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const provider: TextFormatProvider = {
    ...docxViewFake,
    binary: {
      archive: "zip",
      decode: () => Promise.resolve(VIEW),
      explain: (_bytes, context) => {
        if (options.deferred)
          return new Promise((resolve, reject) =>
            calls.push({ locator: context.locator, resolve, reject }),
          );
        const answer = options.answer ?? ((locator) => explanation(locator));
        return Promise.resolve(answer(context.locator));
      },
    },
  };
  const platform = new MemoryPlatform();
  platform.seedFile(DOCX, VIEW, DEFAULT_FILE_FORMAT, MAP);
  platform.seedBinary(DOCX, [1, 2, 3]);
  platform.seedFile(`${DOCX}!/word/document.xml`, "<p>One</p>\n");
  platform.seedFile("C:\\docs\\note.md", "# Note\n");
  (platform as { containers?: ContainerAccess }).containers = fakeContainers();
  const registry = new FormatRegistry();
  registry.register(markdownFake, { default: true });
  registry.register(provider);
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
    workbench.settings.set("explain.visible", true);
    await workbench.openPaths([DOCX]);
  });
  return { workbench, platform, calls };
}

const moveTo = (line: number) =>
  act(() => {
    const view = editorView();
    view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
  });
const pane = () => screen.getByRole("region", { name: "Explain this paragraph" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Explain pane", () => {
  it("shows the rows, their source and what they overrode for the paragraph at the cursor", async () => {
    await setup();
    moveTo(1);
    const row = await within(pane()).findByRole("group", { name: "Left indent" });
    expect(row.textContent).toContain("/p[1] indent");
    expect(within(row).getByRole("button", { name: "Direct formatting" })).toBeTruthy();
    expect(row.textContent).toContain("Overrides 0 cm from Style Normal");
    expect(pane().textContent).toContain("Note for /p[1]");
  });

  it("says what to do when the cursor is not in a paragraph, and does not read the file", async () => {
    const answer = vi.fn(() => explanation("x"));
    await setup({ answer });
    moveTo(3);
    expect(pane().textContent).toContain("Put the cursor in a paragraph");
    await new Promise((r) => setTimeout(r, 300));
    expect(answer).not.toHaveBeenCalled();
  });

  it("says so when the explanation is null or the file cannot be read", async () => {
    let result: Explanation | null | Error = null;
    await setup({
      answer: () => {
        if (result instanceof Error) throw result;
        return result;
      },
    });
    moveTo(1);
    await waitFor(() => expect(pane().textContent).toContain("Put the cursor in a paragraph"));
    result = new Error("damaged");
    moveTo(4);
    await waitFor(() => expect(pane().textContent).toContain("Could not read the file"));
  });

  it("follows the cursor, and never shows an earlier paragraph's rows for a later one", async () => {
    await setup();
    moveTo(1);
    await within(pane()).findByText("/p[1] indent");
    moveTo(4);
    // Straight away, before the new answer: no rows from the old paragraph.
    expect(within(pane()).queryByText("/p[1] indent")).toBeNull();
    expect(await within(pane()).findByText("/p[2] indent")).toBeTruthy();
  });

  it("does not ask again for a move within the same paragraph", async () => {
    const answer = vi.fn((locator: string) => explanation(locator));
    await setup({ answer });
    moveTo(1);
    await within(pane()).findByText("/p[1] indent");
    moveTo(2);
    await new Promise((r) => setTimeout(r, 300));
    expect(within(pane()).getByText("/p[1] indent")).toBeTruthy();
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it("ignores a slow answer for a paragraph the cursor has left", async () => {
    const { calls } = await setup({ deferred: true });
    moveTo(1);
    await waitFor(() => expect(calls).toHaveLength(1));
    moveTo(4);
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1]!.resolve(explanation("/p[2]")));
    await within(pane()).findByText("/p[2] indent");
    await act(async () => calls[0]!.resolve(explanation("/p[1]")));
    expect(within(pane()).queryByText("/p[1] indent")).toBeNull();
    expect(within(pane()).getByText("/p[2] indent")).toBeTruthy();
  });

  it("leaves with the file: hidden for a document that is not a container view", async () => {
    const { workbench } = await setup();
    moveTo(1);
    await within(pane()).findByText("/p[1] indent");
    await act(async () => void (await workbench.openPaths(["C:\\docs\\note.md"])));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Explain this paragraph" })).toBeNull(),
    );
  });

  it("reveals a layer's XML from the source button", async () => {
    const { workbench } = await setup();
    const reveal = vi.spyOn(workbench, "revealPart").mockResolvedValue(true);
    moveTo(1);
    fireEvent.click(await within(pane()).findByRole("button", { name: "Direct formatting" }));
    expect(reveal).toHaveBeenCalledWith(PART, "/p[1]/ind");
  });

  it("offers a repair that calls removePartElement once, then says it is done", async () => {
    const { workbench } = await setup({ answer: (l) => explanation(l, true) });
    const remove = vi.spyOn(workbench, "removePartElement").mockResolvedValue(true);
    moveTo(1);
    const button = await within(pane()).findByRole("button", {
      name: "Remove this paragraph's own indent",
    });
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    expect(remove).toHaveBeenCalledWith(PART, "/p[1]/ind");
    fireEvent.click(button);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(pane().textContent).toContain("Done.");
  });

  it("keeps the repair available when it did not apply", async () => {
    const { workbench } = await setup({ answer: (l) => explanation(l, true) });
    const remove = vi.spyOn(workbench, "removePartElement").mockResolvedValue(false);
    moveTo(1);
    const button = await within(pane()).findByRole("button", {
      name: "Remove this paragraph's own indent",
    });
    fireEvent.click(button);
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(button.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

describe("pictures in the Explain pane", () => {
  it("lists the same picture drawn twice without a React key clash, each button named", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const picture = { part: "word/media/image1.png", alt: "", size: "1 × 1 cm" };
    await setup({
      answer: (l) => ({
        ...explanation(l),
        pictures: [
          { ...picture, name: "Logo" },
          { ...picture, name: "Logo again" },
        ],
      }),
    });
    moveTo(1);
    await within(pane()).findByRole("button", { name: "Show picture Logo again" });
    expect(within(pane()).getByRole("button", { name: "Show picture Logo" })).toBeTruthy();
    const keyWarnings = errors.mock.calls.filter((call) => String(call[0]).includes("same key"));
    expect(keyWarnings).toEqual([]);
  });
});
