import { zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import type { Explanation } from "../../core/explain";
import { clearExplainCache, explainCacheBuilds, explainDocxBytes } from "./explain-bytes";
import { handDocx } from "./test-helpers";
import { callDocx } from "./worker-client";

const STYLES = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`;
const LOCATOR = "/w:document/w:body/w:p";
const PART = "word/document.xml";

function docx(left: string, extra = ""): Uint8Array {
  const src = handDocx(`<w:p><w:pPr><w:ind w:left="${left}"/></w:pPr></w:p>${extra}`, {
    styles: STYLES,
  });
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  for (const name of src.names()) files[name] = encoder.encode(src.text(name) ?? "");
  return zipSync(files, { level: 0 }); // stored, so equal-length edits give equal-length archives
}

function leftIndent(e: Explanation | null): string | undefined {
  for (const s of e?.sections ?? [])
    for (const r of s.rows) if (r.label === "Left indent") return r.value;
  return undefined;
}

const ask = (bytes: Uint8Array, locator = LOCATOR) =>
  explainDocxBytes(bytes, { path: "a.docx", part: PART, locator });

describe("explainDocxBytes cache", () => {
  beforeEach(() => clearExplainCache());

  it("unzips and parses once for repeated questions about identical bytes", async () => {
    const bytes = docx("720");
    const first = await ask(bytes);
    // A separate array with the same content, as a fresh read of the same file gives.
    const second = await ask(bytes.slice());
    expect(explainCacheBuilds()).toBe(1);
    expect(second).toEqual(first);
    expect(leftIndent(second)).toBe("1.27 cm (36 pt)");
  });

  it("answers different paragraphs of the same file from the one cache entry", async () => {
    const bytes = docx("720", `<w:p><w:pPr><w:ind w:left="1440"/></w:pPr></w:p>`);
    expect(leftIndent(await ask(bytes, `${LOCATOR}[1]`))).toBe("1.27 cm (36 pt)");
    expect(leftIndent(await ask(bytes, `${LOCATOR}[2]`))).toBe("2.54 cm (72 pt)");
    expect(explainCacheBuilds()).toBe(1);
  });

  it("never serves a changed file from the cache", async () => {
    const original = docx("720");
    expect(leftIndent(await ask(original))).toBe("1.27 cm (36 pt)");
    // Same length, one digit different: a length check or a sampled hash could miss this.
    const changed = docx("740");
    expect(changed.length).toBe(original.length);
    expect(leftIndent(await ask(changed))).toBe("1.31 cm (37 pt)");
    expect(explainCacheBuilds()).toBe(2);
  });

  it("is not fooled by the caller rewriting an array it passed earlier", async () => {
    const shared = docx("720");
    expect(leftIndent(await ask(shared))).toBe("1.27 cm (36 pt)");
    const replacement = docx("740");
    expect(replacement.length).toBe(shared.length);
    shared.set(replacement); // the same array object, new content
    expect(leftIndent(await ask(shared))).toBe("1.31 cm (37 pt)");
    expect(explainCacheBuilds()).toBe(2);
  });

  it("does not keep an entry for a file it could not read", async () => {
    await ask(docx("720"));
    await expect(ask(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    expect(leftIndent(await ask(docx("720")))).toBe("1.27 cm (36 pt)");
  });
});

describe("callDocx explain without a Worker (the in-thread fallback)", () => {
  beforeEach(() => clearExplainCache());

  it("explains on the calling thread and reuses the cache", async () => {
    const bytes = docx("720");
    const args = { path: "a.docx", part: PART, locator: LOCATOR };
    const a = await callDocx("explain", bytes, args);
    const b = await callDocx("explain", bytes.slice(), args);
    expect(leftIndent(a)).toBe("1.27 cm (36 pt)");
    expect(b).toEqual(a);
    expect(explainCacheBuilds()).toBe(1);
  });

  it("passes a damaged-file error through", async () => {
    await expect(
      callDocx("explain", new Uint8Array([1, 2, 3]), {
        path: "x.docx",
        part: PART,
        locator: LOCATOR,
      }),
    ).rejects.toThrow();
  });
});
