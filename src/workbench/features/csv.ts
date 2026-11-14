/**
 * Settings glue for CSV and TSV documents. A format provider can read settings but not change
 * them, so the command that cycles the delimiter lives here. It knows the format only by id; all
 * format code stays in `src/formats/csv/`.
 *
 * Changing `csv.delimiter` rebuilds the provider's editor extensions (the column colouring); the
 * preview re-renders by itself because `csv.*` settings are passed to the render worker.
 */
import type { Feature } from "../feature";

const FORMAT_ID = "csv";
const CYCLE = ["auto", "comma", "semicolon", "tab", "pipe"] as const;
const NAMES: Record<(typeof CYCLE)[number], string> = {
  auto: "detected automatically",
  comma: "comma",
  semicolon: "semicolon",
  tab: "tab",
  pipe: "pipe",
};

export const csv: Feature = {
  id: "csv",

  commands: (wb) => [
    {
      id: "csv.cycleDelimiter",
      title: "Cycle CSV delimiter",
      enabled: () => wb.activeDocument()?.providerId === FORMAT_ID,
      run: () => {
        const current = wb.settings.get("csv.delimiter");
        const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length] ?? "auto";
        wb.settings.set("csv.delimiter", next);
        wb.notify({ message: `Delimiter: ${NAMES[next]}` });
      },
    },
  ],

  activate(wb) {
    return wb.settings.subscribe("csv.delimiter", () => wb.reconfigureEditors("provider"));
  },
};
