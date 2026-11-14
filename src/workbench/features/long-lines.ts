/**
 * A very long line (a minified or machine-written file, such as the one-line `document.xml` Word
 * writes) makes any text editor slow. When a document opens with one, and its format declares a
 * command that breaks lines up (`longLineCommand`), offer that command in a notification. The
 * feature knows no format: it reads only the declaration.
 */
import type { Feature } from "../feature";

/** A line longer than this many characters triggers the offer. */
export const LONG_LINE = 50_000;

export function hasLongLine(text: string, limit = LONG_LINE): boolean {
  let start = 0;
  for (;;) {
    const end = text.indexOf("\n", start);
    if (end < 0) return text.length - start > limit;
    if (end - start > limit) return true;
    start = end + 1;
  }
}

export const longLines: Feature = {
  id: "long-lines",
  activate(wb) {
    return wb.onDidOpenDocument((doc) => {
      const id = wb.registry.byId(doc.providerId)?.longLineCommand;
      if (!id || !wb.commands.get(id)) return;
      const text = wb.getText(doc.id);
      if (text === undefined || !hasLongLine(text)) return;
      wb.notify({
        message: `${doc.title} has a very long line, which makes editing slow. Tidy can split it into lines.`,
        actions: [
          {
            label: "Tidy",
            run: () => {
              if (wb.activeDocument()?.id === doc.id) void wb.runCommand(id);
            },
          },
        ],
      });
    });
  },
};
