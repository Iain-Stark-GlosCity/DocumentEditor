import type { FileFormat } from "../platform/platform";

export interface StatusBarProps {
  cursor: { line: number; col: number } | null;
  format: FileFormat | null;
}

const ENCODING_NAMES = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
} as const;

export function encodingLabel(format: FileFormat): string {
  return `${ENCODING_NAMES[format.encoding]}${format.bom ? " with BOM" : ""}`;
}

export function eolLabel(format: FileFormat): string {
  const name = format.eol === "crlf" ? "CRLF" : "LF";
  return format.mixedEol ? `${name} (mixed)` : name;
}

export function StatusBar({ cursor, format }: StatusBarProps) {
  return (
    <footer className="statusbar" aria-label="Status">
      {cursor && format ? (
        <>
          <span>
            Ln {cursor.line}, Col {cursor.col}
          </span>
          <span>{encodingLabel(format)}</span>
          <span>{eolLabel(format)}</span>
        </>
      ) : (
        <span>No document open</span>
      )}
    </footer>
  );
}
