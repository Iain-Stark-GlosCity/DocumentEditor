import type { LiveRenderer } from "../types";
import {
  atxHeading,
  blockquote,
  fencedCode,
  horizontalRule,
  indentedCode,
  leftAsSource,
  listMark,
  quoteMark,
  setextHeading,
  task,
} from "./blocks";
import { image } from "./images";
import {
  autolink,
  bareUrl,
  emphasis,
  entity,
  escape,
  inlineCode,
  link,
  strikethrough,
  strong,
} from "./inline";

/** The renderers live preview ships with. Facet-provided renderers run before these. */
export const builtinRenderers: readonly LiveRenderer[] = [
  leftAsSource,
  atxHeading,
  setextHeading,
  blockquote,
  quoteMark,
  listMark,
  task,
  horizontalRule,
  fencedCode,
  indentedCode,
  image,
  emphasis,
  strong,
  strikethrough,
  inlineCode,
  link,
  autolink,
  bareUrl,
  escape,
  entity,
];
