/**
 * Findings: what an integrity check reports about a container file (a DOCX, and later ODT and
 * others). A finding says what is wrong or suspicious, why it matters in plain English, and where
 * it is, so the user can jump to the exact element. Pure types and helpers.
 */

export type FindingSeverity = "error" | "warning" | "info";

/** A place inside a container: a part, and optionally an element inside it. */
export interface FindingLocation {
  /** The part's name inside the archive, for example `word/document.xml`. */
  part: string;
  /**
   * An element path inside the part that the part's own format can find again (see
   * `TextFormatProvider.locate`), for example `/w:document/w:body/w:p[12]`: names as written in the
   * part, 1-based position among same-named siblings.
   */
  locator?: string;
  /** A short human label for the place, for example "paragraph 12". */
  label?: string;
}

export interface Finding {
  /** Stable for the same problem in the same place across runs, so a list does not flicker. */
  id: string;
  /** A dotted rule code, for example `package.relationship-target-missing`. Never changes. */
  rule: string;
  severity: FindingSeverity;
  /** A short group name: `package`, `styles`, `numbering`, `sections`, `formatting`, `revisions`, `notes`. */
  family: string;
  /** One line saying what was found. May name a style or an id. */
  title: string;
  /** Plain English: why this matters (what Word may do, or what the user may notice). */
  why: string;
  /** Where to look, most relevant first. May be empty for a whole-package finding. */
  locations: FindingLocation[];
  /** Short facts such as counts and ids. Never any text from the document's content. */
  facts?: Record<string, string | number | boolean>;
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Errors first, then warnings, then info; within a severity by family, then rule, then id. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.family.localeCompare(b.family) ||
      a.rule.localeCompare(b.rule) ||
      a.id.localeCompare(b.id),
  );
}

export function countBySeverity(findings: readonly Finding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/**
 * A plain-text report that is safe to paste into a chat or an issue: rule codes, severities,
 * counts and locations (part names and element paths) only. It never includes a finding's title,
 * its explanation, string facts, or any document text, because those can name styles, people or
 * other content from the document.
 */
export function formatFindingsReport(
  findings: readonly Finding[],
  heading = "Integrity report",
): string {
  const sorted = sortFindings(findings);
  const counts = countBySeverity(sorted);
  const lines = [
    heading,
    `${counts.error} errors, ${counts.warning} warnings, ${counts.info} notes`,
    "",
  ];
  for (const finding of sorted) {
    lines.push(`${finding.severity.toUpperCase()} ${finding.rule}`);
    for (const location of finding.locations) {
      lines.push(`  at ${location.part}${location.locator ? ` ${location.locator}` : ""}`);
    }
    const numeric = Object.entries(finding.facts ?? {}).filter(
      ([, value]) => typeof value === "number" || typeof value === "boolean",
    );
    if (numeric.length > 0)
      lines.push(`  ${numeric.map(([k, v]) => `${k}=${String(v)}`).join(" ")}`);
  }
  return lines.join("\n");
}
