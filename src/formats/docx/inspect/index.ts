/**
 * The document integrity inspector: a read-only analysis of a Word package's parts that reports
 * what is wrong or suspicious, why it matters, and exactly where (docs/docx-integrity.md lists
 * every rule). Pure and deterministic: no DOM, no Node APIs, safe in a Web Worker. Loaded with
 * `import()` from the format, so none of it is in the startup bundle.
 *
 * It checks structure against rules we can state. It is not validation against Microsoft's
 * schemas, and a clean report does not prove that Word will open the file.
 */
import { ArchiveError, readZip } from "../../../core/archive";
import { sortFindings, type Finding } from "../../../core/findings";
import type { PartSource } from "../package";
import { InspectContext } from "./context";
import type { Rule } from "./rule";
import { formattingRules } from "./rules-formatting";
import { paragraphRules } from "./rules-paragraphs";
import { numberingRules } from "./rules-numbering";
import { packageRules, wellFormedRule } from "./rules-package";
import { revisionRules } from "./rules-revisions";
import { sectionRules } from "./rules-sections";
import { styleRules } from "./rules-styles";

export type { Rule } from "./rule";

/** Every rule, in the order they run. */
export const RULES: readonly Rule[] = [
  ...packageRules,
  ...styleRules,
  ...numberingRules,
  ...sectionRules,
  ...formattingRules,
  ...paragraphRules,
  ...revisionRules,
  wellFormedRule,
];

/** At most this many findings are returned; the rest are summarised in one finding. */
export const MAX_FINDINGS = 300;

/** Inspects a Word package. Never throws; a rule that fails is reported and the rest still run. */
export function inspectDocx(source: PartSource): Finding[] {
  return inspectWith(source, RULES);
}

/** Inspects with a given set of rules (for tests). */
export function inspectWith(source: PartSource, rules: readonly Rule[]): Finding[] {
  const ctx = new InspectContext(source);
  for (const rule of rules) {
    const before = ctx.findings.length;
    try {
      rule.run(ctx);
    } catch {
      // Drop anything the rule reported before it failed: half a rule's findings mislead.
      ctx.findings.length = before;
      ctx.report({
        rule: "inspect.rule-failed",
        severity: "info",
        family: "package",
        title: `The check "${rule.name}" could not finish on this file`,
        why: "Something in the file made this check fail, so its problems (if any) are not listed. The other checks ran normally.",
        key: rule.name,
        hits: [],
        facts: { check: rule.name },
      });
    }
  }
  let findings = sortFindings(ctx.findings);
  if (findings.length > MAX_FINDINGS) {
    const dropped = findings.length - (MAX_FINDINGS - 1);
    findings = findings.slice(0, MAX_FINDINGS - 1);
    findings.push({
      id: "inspect.truncated",
      rule: "inspect.truncated",
      severity: "info",
      family: "package",
      title: `${dropped} more findings are not listed`,
      why: "The file has so many problems that only the most serious are listed. Fix those first and inspect again.",
      locations: [],
      facts: { count: dropped },
    });
  }
  return findings;
}

/** Part bytes to text: UTF-8 by default, UTF-16 when a BOM says so; the BOM is dropped. */
function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The parts of a zip, read lazily, as the inspector reads them. */
export function partSourceFromZip(bytes: Uint8Array): PartSource {
  const zip = readZip(bytes);
  const names = zip.entries.filter((e) => !e.isDirectory).map((e) => e.name);
  const cache = new Map<string, string | undefined>();
  return {
    names: () => names,
    text(name) {
      if (cache.has(name)) return cache.get(name);
      let text: string | undefined;
      try {
        text = decodeText(zip.bytes(name));
      } catch {
        text = undefined;
      }
      cache.set(name, text);
      return text;
    },
  };
}

/** Inspects the bytes of a .docx. A file that is not a readable zip gives one error finding. */
export async function inspectDocxBytes(
  bytes: Uint8Array,
  context: { path: string },
): Promise<Finding[]> {
  void context;
  let source: PartSource;
  try {
    source = partSourceFromZip(bytes);
  } catch (error) {
    return [
      {
        id: "package.unreadable",
        rule: "package.unreadable",
        severity: "error",
        family: "package",
        title: "The file is not a readable zip package",
        why: "A Word document is a zip of XML parts. This file could not be read as one, so Word cannot open it either, and nothing else could be checked.",
        locations: [],
        facts: { archiveError: error instanceof ArchiveError },
      },
    ];
  }
  return inspectDocx(source);
}
