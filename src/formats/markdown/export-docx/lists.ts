/**
 * Word numbering for Markdown lists. Every Markdown list gets a numbering definition of its own, so
 * separate ordered lists each start at their own number (`start`), and a list nested in another
 * restarts under each item, as in the preview. A list at nesting depth `d` uses level `d` of its
 * definition (Word has nine levels, so deeper lists stay at the ninth) and that level's indent is
 * where the list sits on the page, so lists in quotes and in other lists line up with their text.
 */
import { AlignmentType, LevelFormat, type ILevelsOptions, type INumberingOptions } from "docx";

/** Word's nine list levels. */
export const MAX_LEVEL = 8;
/** How far a list's text is from the content it sits in, and the number's hanging indent. */
export const LIST_STEP = 720;
export const HANGING = 360;
/** The deepest indent the export uses, so very deep nesting never runs off the page. */
export const MAX_INDENT = 5760;
/** Word's largest list start number. */
const MAX_START = 32767;

const BULLETS = ["•", "◦", "▪"];

export interface ListSpec {
  ordered: boolean;
  start: number;
  /** Level (0 to 8) the list's items use. */
  level: number;
  /** Indent of the content the list sits in, in twips. */
  base: number;
}

export type NumberingConfig = INumberingOptions["config"][number];

/** Where a list's item text starts, in twips. */
export function itemIndent(base: number): number {
  return Math.min(base + LIST_STEP, MAX_INDENT);
}

/** The numbering definition for one list. */
export function numberingConfig(reference: string, spec: ListSpec): NumberingConfig {
  const start = Math.max(0, Math.min(MAX_START, Math.floor(spec.start)));
  const levels: ILevelsOptions[] = [];
  for (let level = 0; level <= MAX_LEVEL; level += 1) {
    const offset = level - spec.level;
    const left = Math.max(
      LIST_STEP,
      Math.min(MAX_INDENT, itemIndent(spec.base) + offset * LIST_STEP),
    );
    levels.push({
      level,
      format: spec.ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
      text: spec.ordered ? `%${level + 1}.` : BULLETS[level % BULLETS.length]!,
      alignment: AlignmentType.LEFT,
      start: level === spec.level ? start : 1,
      style: { paragraph: { indent: { left, hanging: HANGING } } },
    });
  }
  return { reference, levels };
}
