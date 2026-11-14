import type { FormatCommand, TextFormatProvider } from "../../core/format";
import { csvColumns } from "./colour";
import { resolveDelimiter } from "./parse";

const DELIMITER_CYCLE = ["auto", "comma", "semicolon", "tab", "pipe"] as const;

/** Moves `csv.delimiter` to the next choice. The delimiter is a `settings` key, so it applies live. */
const cycleDelimiter: FormatCommand = {
  id: "csv.cycleDelimiter",
  title: "Cycle CSV delimiter",
  run(_view, host) {
    if (!host) return false;
    const current = host.setting<string>("csv.delimiter", "auto");
    const index = DELIMITER_CYCLE.findIndex((d) => d === current);
    const next = DELIMITER_CYCLE[(index + 1) % DELIMITER_CYCLE.length] ?? "auto";
    host.setSetting("csv.delimiter", next);
    host.notify(`Delimiter: ${next === "auto" ? "detected automatically" : next}`);
    return true;
  },
};

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
  settings: ["csv.delimiter"],
  commands: [cycleDelimiter],
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
