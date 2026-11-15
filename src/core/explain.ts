/**
 * An explanation of why one part of a document looks the way it does: for each property, the value
 * that wins and the layers it came from. Produced by a format's `BinaryView.explain`, shown by the
 * Explain pane. Plain data, free of any document text.
 */

/** Where a value (or an overridden value) was defined. */
export interface ExplanationSource {
  /** For example `Direct formatting`, `Style "Heading 1"`, `Document defaults`. */
  label: string;
  /** The part and element to reveal, when the value was written in one. */
  part?: string;
  locator?: string;
}

export interface ExplanationRow {
  label: string;
  /** The effective value, for example `1.27 cm (36 pt)`, or `not set`. */
  value: string;
  /** The layer that decided it; absent when nothing sets the property. */
  source?: ExplanationSource;
  /** Earlier layers that set the property and lost, strongest first. */
  overridden?: { source: ExplanationSource; value: string }[];
  /** True when Word's precedence for this row is not certain (see `note`). */
  uncertain?: boolean;
  note?: string;
}

export interface ExplanationSection {
  heading: string;
  rows: ExplanationRow[];
}

export interface Explanation {
  title: string;
  sections: ExplanationSection[];
  /** Things the resolver does not cover for this item, in plain words. */
  notes: string[];
}
