/**
 * What the block and inline converters share while one document is converted: link and footnote
 * definitions, pictures already read, heading bookmarks, and the footnotes and lists made so far.
 */
import type { Definition, FootnoteDefinition, Heading } from "mdast";
import type { ImageResult } from "./images";
import type { NumberingConfig } from "./lists";

export interface Env {
  /** The Markdown source, for text that is best taken as written (inline maths). */
  source: string;
  /** Link and image reference definitions by normalised identifier; the first one wins. */
  definitions: Map<string, Definition>;
  footnoteDefinitions: Map<string, FootnoteDefinition>;
  /** What became of each picture address. */
  images: Map<string, ImageResult>;
  /** Heading slug (as the preview makes it) to the Word bookmark name on that heading. */
  anchors: Map<string, string>;
  /** The bookmark name of each heading that has one. */
  headingBookmarks: Map<Heading, string>;
  /** Footnotes made so far, in reference order. A note referred to twice is made twice. */
  notes: { id: number; definition: FootnoteDefinition }[];
  /** List numbering definitions made so far. */
  lists: NumberingConfig[];
}

export function createEnv(source: string): Env {
  return {
    source,
    definitions: new Map(),
    footnoteDefinitions: new Map(),
    images: new Map(),
    anchors: new Map(),
    headingBookmarks: new Map(),
    notes: [],
    lists: [],
  };
}
