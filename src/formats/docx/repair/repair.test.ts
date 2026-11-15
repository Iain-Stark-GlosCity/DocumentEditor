import { describe, expect, it } from "vitest";
import { handDocx } from "../test-helpers";
import { parseXml } from "../xml";
import { applyEdits, innerRange, offersFor, planFor, PartEditor, REPAIRS } from "./index";

const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Plan</dc:title><dc:creator>Jane Smith</dc:creator><cp:lastModifiedBy>Bob Jones</cp:lastModifiedBy></cp:coreProperties>`;
const APP = `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Company>Acme Ltd</Company><Manager></Manager><Pages>3</Pages></Properties>`;

describe("applyEdits", () => {
  it("applies edits in any order, keeping all other text", () => {
    expect(
      applyEdits("0123456789", [
        { from: 6, to: 8, insert: "X" },
        { from: 0, to: 1, insert: "" },
        { from: 9, to: 9, insert: "!" },
      ]),
    ).toBe("12345X8!9");
  });
  it("refuses overlapping or out-of-range edits", () => {
    expect(() =>
      applyEdits("abcdef", [
        { from: 1, to: 4, insert: "" },
        { from: 3, to: 5, insert: "" },
      ]),
    ).toThrow(/overlap/);
    expect(() => applyEdits("abc", [{ from: 2, to: 9, insert: "" }])).toThrow(/outside/);
  });
});

describe("innerRange and PartEditor", () => {
  const doc = parseXml("<a><b x='1'>text</b><c/><d></d></a>");
  const [b, c, d] = doc.root!.children.filter((n) => typeof n !== "string");
  it("finds an element's content, none for a self-closing element, an empty range for an empty one", () => {
    const text = (el: typeof b) => {
      const r = innerRange(doc.source, el!);
      return r ? doc.source.slice(r.from, r.to) : null;
    };
    expect(text(b)).toBe("text");
    expect(text(c)).toBeNull();
    expect(text(d)).toBe("");
  });
  it("edits one element and leaves the rest of the text exactly as it was", () => {
    const editor = new PartEditor("p.xml", doc);
    editor.setInner(b!, "");
    editor.remove(c!);
    expect(editor.result()).toBe("<a><b x='1'></b><d></d></a>");
    expect(editor.count).toBe(2);
  });
});

describe("the repair registry", () => {
  it("lists every repair once, with unique ids", () => {
    const ids = REPAIRS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("offers nothing, and plans nothing, for a clean package", () => {
    const src = handDocx("<w:p/>");
    expect(offersFor(src)).toEqual([]);
    expect(planFor(src, "docx.scrub-properties")).toBeNull();
    expect(planFor(src, "no.such.repair")).toBeNull();
  });
});

describe("docx.scrub-properties", () => {
  const src = () =>
    handDocx("<w:p/>", { extra: { "docProps/core.xml": CORE, "docProps/app.xml": APP } });

  it("is offered with a count that holds no names", () => {
    const offers = offersFor(src());
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ id: "docx.scrub-properties" });
    expect(offers[0]!.summary).toBe("3 names or organisations in the properties");
    expect(JSON.stringify(offers)).not.toMatch(/Jane|Bob|Acme/);
  });

  it("empties only those fields, byte for byte elsewhere, keeping the part's own line endings", () => {
    const plan = planFor(src(), "docx.scrub-properties")!;
    const core = plan.changes.find((c) => c.part === "docProps/core.xml")!;
    expect(core.text).toBe(
      CORE.replace("<dc:creator>Jane Smith</dc:creator>", "<dc:creator></dc:creator>").replace(
        "<cp:lastModifiedBy>Bob Jones</cp:lastModifiedBy>",
        "<cp:lastModifiedBy></cp:lastModifiedBy>",
      ),
    );
    expect(core.text).toContain("\r\n");
    expect(core.text).toContain("<dc:title>Plan</dc:title>");
    const app = plan.changes.find((c) => c.part === "docProps/app.xml")!;
    expect(app.text).toBe(APP.replace("Acme Ltd", ""));
    expect(JSON.stringify(plan.details)).not.toMatch(/Jane|Bob|Acme/);
  });

  it("is idempotent: once applied, it is no longer offered", () => {
    const plan = planFor(src(), "docx.scrub-properties")!;
    const after = handDocx("<w:p/>", {
      extra: Object.fromEntries(plan.changes.map((c) => [c.part, c.text])),
    });
    expect(offersFor(after)).toEqual([]);
  });

  it("leaves a damaged part alone", () => {
    const broken = handDocx("<w:p/>", {
      extra: { "docProps/core.xml": "<cp:coreProperties><dc:creator>X</cp:coreProperties>" },
    });
    expect(planFor(broken, "docx.scrub-properties")).toBeNull();
  });
});
