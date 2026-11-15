import { describe, expect, it } from "vitest";
import { callDocx } from "./worker-client";

describe("callDocx without a Worker (as in these tests)", () => {
  it("runs on the calling thread and passes a damaged-file error through", async () => {
    await expect(
      callDocx("inspect", new Uint8Array([1, 2, 3]), { path: "x.docx" }),
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "package.unreadable" })]),
    );
    await expect(
      callDocx("decode", new Uint8Array([1, 2, 3]), { path: "x.docx" }),
    ).rejects.toThrow();
  });
});
