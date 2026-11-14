import { afterEach, describe, expect, it, vi } from "vitest";
import { xmlProblem } from "./xml-check";

/** A DOMParser that reports the given parser error text, as a browser would. */
function parserReporting(text: string) {
  vi.stubGlobal(
    "DOMParser",
    class {
      parseFromString() {
        return { getElementsByTagNameNS: () => [{ textContent: text }] };
      }
    },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("xmlProblem", () => {
  it("accepts well-formed XML", () => {
    expect(xmlProblem("<a><b/></a>")).toBeNull();
    expect(xmlProblem('<?xml version="1.0"?><w:p xmlns:w="urn:w"/>')).toBeNull();
  });

  it("names the line and column of a Chromium error and drops its stray rendering note", () => {
    parserReporting(
      "error on line 1 at column 8: Unexpected token inside qualified name: <?Below is a rendering of the page up to the first error.",
    );
    expect(xmlProblem("<broken<?xml?>")).toBe(
      "line 1, column 8: Unexpected token inside qualified name: <?",
    );
  });

  it("drops the note when it is on its own line too", () => {
    parserReporting(
      "error on line 3 at column 7: Opening and ending tag mismatch: a line 1 and b\nBelow is a rendering of the page up to the first error.",
    );
    expect(xmlProblem("<x/>")).toBe(
      "line 3, column 7: Opening and ending tag mismatch: a line 1 and b",
    );
  });

  it("copes with a Firefox style message and with free text", () => {
    parserReporting("XML Parse Error: mismatched tag.\nLocation: x\nLine Number 4, Column 2:");
    expect(xmlProblem("<x/>")).toBe("line 4, column 2: mismatched tag.");
    parserReporting("something odd");
    expect(xmlProblem("<x/>")).toBe("something odd");
  });
});
