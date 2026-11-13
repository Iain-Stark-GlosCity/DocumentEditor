import type { FileFormat } from "../../platform/platform";
import type { Feature, FeatureComponentProps } from "../feature";
import { useActiveDocument } from "../hooks";

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

function Encoding({ workbench }: FeatureComponentProps) {
  const doc = useActiveDocument(workbench);
  return doc ? <span>{encodingLabel(doc.format)}</span> : null;
}

function LineEnding({ workbench }: FeatureComponentProps) {
  const doc = useActiveDocument(workbench);
  return doc ? <span>{eolLabel(doc.format)}</span> : null;
}

/** Encoding and line ending of the file, as detected on open. */
export const statusFormat: Feature = {
  id: "status-format",
  statusItems: [
    { id: "encoding", order: 20, component: Encoding },
    { id: "eol", order: 30, component: LineEnding },
  ],
};
