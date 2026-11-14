// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { csvProvider } from "./index";
import { renderCsvTable, type TableOptions } from "./table";

const defaults: TableOptions = { delimiter: ",", headerRow: true, previewRows: 1000 };

function render(text: string, options: Partial<TableOptions> = {}): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderCsvTable(text, { ...defaults, ...options });
  return root;
}

const cells = (row: Element) => Array.from(row.children).map((c) => c.textContent);

describe("renderCsvTable", () => {
  it("makes a table with a heading row, a row-number column and the values", () => {
    const root = render("name,qty\nfoo,1\nbar,2\n");
    const head = root.querySelectorAll("thead th");
    expect(Array.from(head).map((h) => h.textContent)).toEqual(["#", "name", "qty"]);
    expect(Array.from(head).every((h) => h.getAttribute("scope") === "col")).toBe(true);
    const rows = root.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(cells(rows[0] as Element)).toEqual(["1", "foo", "1"]);
    expect(rows[1]?.querySelector("th")?.getAttribute("scope")).toBe("row");
  });

  it("treats the first row as data when the header setting is off", () => {
    const root = render("a,b\n1,2\n", { headerRow: false });
    expect(root.querySelector("thead")).toBeNull();
    expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("puts the source line of each row's start in data-line", () => {
    const root = render('h1,h2\n"multi\nline",x\n\nlast,y\n');
    const lines = Array.from(root.querySelectorAll("tr")).map((r) => r.getAttribute("data-line"));
    expect(lines).toEqual(["1", "2", "5"]);
    // The quoted line break stays inside one cell of one row.
    expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(root.querySelectorAll("tbody tr")[0]?.textContent).toContain("multi\nline");
  });

  it("escapes every cell: no element, attribute or script can come from the file", () => {
    const hostile = [
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      "=cmd|' /C calc'!A0",
      '"><svg onload=alert(1)>',
      "&lt;b&gt; &amp;",
    ];
    const text = `${hostile.map((h) => `"${h.replace(/"/g, '""')}"`).join(",")}\n${hostile
      .map((h) => `"${h.replace(/"/g, '""')}"`)
      .join(",")}\n`;
    const html = renderCsvTable(text, defaults);
    expect(html).not.toMatch(/<(script|img|svg)/i);
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(root.querySelector("script, img, svg")).toBeNull();
    const first = root.querySelector("tbody tr");
    expect(first?.children[1]?.textContent).toBe(hostile[0]);
    expect(first?.children[2]?.textContent).toBe(hostile[1]);
    // A formula stays inert text.
    expect(first?.children[3]?.textContent).toBe("=cmd|' /C calc'!A0");
    expect(first?.children[5]?.textContent).toBe("&lt;b&gt; &amp;");
  });

  it("escapes the heading cells too", () => {
    const root = render('"<img src=x onerror=alert(1)>",b\n1,2\n');
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("thead th:nth-child(2)")?.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("emits only a fixed set of tags, attributes and class names", () => {
    const text = 'a,b,c\n1,"<b>x</b>"\n2,y,z,extra\n,,\n';
    const root = render(text);
    const tags = new Set(
      Array.from(root.querySelectorAll("*")).map((e) => e.tagName.toLowerCase()),
    );
    expect([...tags].sort()).toEqual([
      "caption",
      "span",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
    ]);
    const attributes = new Set<string>();
    const classes = new Set<string>();
    for (const el of Array.from(root.querySelectorAll("*"))) {
      for (const name of el.getAttributeNames()) attributes.add(name);
      el.classList.forEach((c) => classes.add(c));
    }
    expect([...attributes].sort()).toEqual(["aria-hidden", "class", "data-line", "scope"]);
    for (const c of classes) expect(c).toMatch(/^csv-[a-z]+$/);
  });

  it("right-aligns a column when at least 90 per cent of its non-empty cells are numeric", () => {
    const rows = Array.from({ length: 10 }, (_, i) => `${i},${i === 0 ? "n/a" : i},word`);
    const root = render(`id,mostly,text\n${rows.join("\n")}\n`);
    const row = root.querySelector("tbody tr");
    // Column "id": all numeric. "mostly": 9 of 10. "text": none.
    expect(row?.children[1]?.classList.contains("csv-num")).toBe(true);
    expect(row?.children[2]?.classList.contains("csv-num")).toBe(true);
    expect(row?.children[3]?.classList.contains("csv-num")).toBe(false);
    // The heading follows its column.
    expect(root.querySelector("thead th:nth-child(2)")?.classList.contains("csv-num")).toBe(true);
  });

  it("does not right-align below 90 per cent, and ignores empty cells", () => {
    const below = render("a\n1\n2\nx\n");
    expect(below.querySelector("tbody td")?.classList.contains("csv-num")).toBe(false);
    const empties = render('a\n1\n""\n2\n');
    // Blank lines are skipped, but a quoted empty is an empty cell and does not count against it.
    expect(empties.querySelector("tbody td")?.classList.contains("csv-num")).toBe(true);
  });

  it("reads thousands separators, signs, decimals, exponents and percentages as numbers", () => {
    const root = render('a\n"1,234.50"\n-3\n+4.5e3\n12%\n£7\n');
    expect(root.querySelector("tbody td")?.classList.contains("csv-num")).toBe(true);
    const words = render("a\n12abc\n1-2\n.\n-\n");
    expect(words.querySelector("tbody td")?.classList.contains("csv-num")).toBe(false);
  });

  it("shows only the first rows, with a note that says how many there are", () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `${i},x`).join("\n");
    const root = render(`n,v\n${lines}\n`, { previewRows: 1000 });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(1000);
    expect(root.querySelector(".csv-note")?.textContent).toBe(
      "Showing the first 1,000 of 1,200 rows",
    );
  });

  it("shows no note when everything fits", () => {
    expect(render("a\n1\n2\n").querySelector(".csv-note")).toBeNull();
  });

  it("counts the header outside the row cap", () => {
    const root = render("h\n1\n2\n3\n", { previewRows: 2 });
    expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(root.querySelector(".csv-note")?.textContent).toBe("Showing the first 2 of 3 rows");
  });

  it("flags ragged rows, pads short ones and keeps the extra cells of long ones", () => {
    const root = render("a,b,c\n1,2,3\n4\n5,6,7,8\n");
    const rows = root.querySelectorAll("tbody tr");
    expect(rows[0]?.classList.contains("csv-ragged")).toBe(false);
    expect(rows[1]?.classList.contains("csv-ragged")).toBe(true);
    expect(rows[1]?.querySelectorAll("td.csv-missing")).toHaveLength(3);
    expect(rows[2]?.classList.contains("csv-ragged")).toBe(true);
    expect(rows[2]?.querySelector("td:last-child")?.textContent).toBe("8");
    expect(rows[2]?.querySelector(".csv-sr")?.textContent).toContain("4 fields, expected 3");
    // The table has a column for the widest row.
    expect(root.querySelectorAll("thead th")).toHaveLength(5);
  });

  it("names columns whose heading is empty", () => {
    const root = render("a,,c\n1,2,3\n");
    expect(root.querySelector("thead th:nth-child(3)")?.textContent).toBe("Column 2");
  });

  it("says so for an empty file", () => {
    expect(render("").textContent).toBe("This file has no rows.");
  });

  it("is fast for a large file because it only builds the rows it shows", () => {
    const text = Array.from({ length: 100_000 }, (_, i) => `${i},a,b,c,d,e,f,g,h,i`).join("\n");
    const start = performance.now();
    const html = renderCsvTable(text, { ...defaults, previewRows: 1000 });
    expect(performance.now() - start).toBeLessThan(3000);
    expect(html).toContain("Showing the first 1,000 of 99,999 rows");
  });
});

describe("csvProvider", () => {
  it("claims csv and tsv, offers source and split, and turns spellcheck off", () => {
    expect(csvProvider.id).toBe("csv");
    expect(csvProvider.fileExtensions).toEqual(["csv", "tsv"]);
    expect(csvProvider.viewModes).toEqual(["source", "split"]);
    expect(csvProvider.spellcheck).toBe(false);
  });

  it("renders with the settings it is given, clamping the row cap", async () => {
    const context = {
      path: "/a.csv",
      resolveAsset: () => "",
      settings: { "csv.delimiter": "semicolon", "csv.headerRow": false, "csv.previewRows": 1 },
    };
    const { html } = await csvProvider.render!("a;b\n1;2\n", context);
    // 1 is below the minimum of 50, so both rows show; no heading row.
    expect(html).not.toContain("<thead>");
    expect(html.match(/<tr /g)).toHaveLength(2);
  });

  it("reads a .tsv path as tab-separated by default", async () => {
    const { html } = await csvProvider.render!("a\tb\n1\t2\n", {
      path: "/a.tsv",
      resolveAsset: () => "",
    });
    expect(html).toMatch(/<th scope="col"[^>]*>b<\/th>/);
  });
});
