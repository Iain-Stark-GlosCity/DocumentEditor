import { describe, expect, it } from "vitest";
import { encodeDestination, escapeLabel, markdownImage, markdownLink } from "./images";

describe("markdown image syntax", () => {
  it("writes a plain image", () => {
    expect(markdownImage("./assets/a.png", "")).toBe("![](./assets/a.png)");
    expect(markdownImage("../x/a.png", "A photo")).toBe("![A photo](../x/a.png)");
  });

  it("encodes characters that would break the destination", () => {
    expect(encodeDestination("./my pics/a (1).png")).toBe("./my%20pics/a%20%281%29.png");
    expect(encodeDestination("./100%.png")).toBe("./100%25.png");
    expect(encodeDestination("./a#b?c<d>e.png")).toBe("./a%23b%3Fc%3Cd%3Ee.png");
    expect(encodeDestination("./[x].png")).toBe("./%5Bx%5D.png");
    expect(encodeDestination("./tab\there.png")).toBe("./tab%09here.png");
  });

  it("leaves ordinary and non-ASCII characters readable", () => {
    expect(encodeDestination("./café/日本.png")).toBe("./café/日本.png");
    expect(encodeDestination("D:/Pictures/a-b_c.png")).toBe("D:/Pictures/a-b_c.png");
  });

  it("escapes the label", () => {
    expect(escapeLabel("a [b] \\ c")).toBe("a \\[b\\] \\\\ c");
    expect(escapeLabel("two\nlines")).toBe("two lines");
    expect(markdownImage("./a.png", "x]y")).toBe("![x\\]y](./a.png)");
  });

  it("writes a link", () => {
    expect(markdownLink("./docs/My File.pdf", "My File.pdf")).toBe(
      "[My File.pdf](./docs/My%20File.pdf)",
    );
  });
});
