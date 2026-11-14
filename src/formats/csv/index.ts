import type { TextFormatProvider } from "../../core/format";
import { csvColumns } from "./colour";
import { resolveDelimiter } from "./parse";

/**
 * CSV and TSV. Source mode colours the columns; the split preview is a table. The table builder
 * is imported when the first preview is requested, so it stays out of the startup bundle
 * (CLAUDE.md rule 6). Parsing and colouring are small and are needed by the editor at once.
 */
export const csvProvider: TextFormatProvider = {
  kind: "text",
  id: "csv",
  name: "CSV and TSV",
  fileExtensions: ["csv", "tsv"],
  viewModes: ["source", "split"],
  spellcheck: false,
  editorExtensions: (context) => [
    csvColumns(context.setting<string>("csv.delimiter", "auto"), context.path),
  ],
  async render(text, context) {
    const { renderCsvTable } = await import("./table");
    const settings = context.settings ?? {};
    const delimiter = settings["csv.delimiter"];
    const rows = settings["csv.previewRows"];
    const previewRows = typeof rows === "number" && Number.isFinite(rows) ? rows : 1000;
    return {
      html: renderCsvTable(text, {
        delimiter: resolveDelimiter(
          typeof delimiter === "string" ? delimiter : "auto",
          text,
          context.path,
        ),
        headerRow: settings["csv.headerRow"] !== false,
        previewRows: Math.min(20_000, Math.max(50, Math.floor(previewRows))),
      }),
    };
  },
};
