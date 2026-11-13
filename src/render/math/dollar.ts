/**
 * Single-dollar inline maths with the usual "pandoc" rules, so prose about money is left alone.
 *
 * `$` opens maths only if the next character is not whitespace. A `$` closes it only if the
 * character before it is not whitespace and the one after it is not a digit. An unescaped `$`
 * after whitespace ends the attempt, which keeps `costs $5 and $10` plain text. `$$...$$` (inline)
 * and `$$` fenced blocks are handled by `remark-math` itself; this adds only the single-dollar
 * form, which `remark-math` cannot restrict.
 *
 * It works at the micromark level (before emphasis and escapes are resolved), so `$a_i * b_i$`
 * and `$\{x\}$` reach KaTeX exactly as written. It emits the same tokens as
 * `micromark-extension-math`, so `mdast-util-math` turns them into the same `inlineMath` nodes.
 */
import {
  asciiDigit,
  markdownLineEnding,
  markdownLineEndingOrSpace,
} from "micromark-util-character";
import type {
  Code,
  Construct,
  Extension,
  State,
  TokenizeContext,
  Tokenizer,
} from "micromark-util-types";
import type { Processor } from "unified";
// Brings in the `mathText` token types this tokenizer emits.
import "micromark-extension-math";

const DOLLAR = 36;
const BACKSLASH = 92;

/** Looks one character past a `$` without consuming anything: matches if that is a digit. */
const followedByDigit: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    return start;
    function start(code: Code): State | undefined {
      effects.enter("mathTextSequence");
      effects.consume(code);
      effects.exit("mathTextSequence");
      return after;
    }
    function after(code: Code): State | undefined {
      return asciiDigit(code) ? ok(code) : nok(code);
    }
  },
};

const tokenizeDollarMath: Tokenizer = function (effects, ok, nok) {
  let previous: Code = null;
  return start;

  function start(code: Code): State | undefined {
    effects.enter("mathText");
    effects.enter("mathTextSequence");
    effects.consume(code);
    effects.exit("mathTextSequence");
    return afterOpen;
  }

  function afterOpen(code: Code): State | undefined {
    // `$$` belongs to remark-math; `$ ` and a lone `$` at the end of a line are not maths.
    if (code === null || code === DOLLAR || markdownLineEndingOrSpace(code)) return nok(code);
    effects.enter("mathTextData");
    return data(code);
  }

  function data(code: Code): State | undefined {
    if (code === null) return nok(code);
    if (markdownLineEnding(code)) {
      effects.exit("mathTextData");
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      previous = code;
      return afterLineEnding;
    }
    if (code === BACKSLASH) {
      effects.consume(code);
      previous = code;
      return escaped;
    }
    if (code === DOLLAR) {
      // A `$` after whitespace is more likely the start of another amount than a closer.
      if (markdownLineEndingOrSpace(previous)) return nok(code);
      return effects.check(followedByDigit, digitFollows, close)(code);
    }
    effects.consume(code);
    previous = code;
    return data;
  }

  function afterLineEnding(code: Code): State | undefined {
    if (code === null) return nok(code);
    effects.enter("mathTextData");
    return data(code);
  }

  /** The character after a backslash is data, even a `$`. */
  function escaped(code: Code): State | undefined {
    if (code === null || markdownLineEnding(code)) return data(code);
    effects.consume(code);
    previous = code;
    return data;
  }

  /** A `$` followed by a digit cannot close (`$5-$10`): keep it as data. */
  function digitFollows(code: Code): State | undefined {
    effects.consume(code);
    previous = code;
    return data;
  }

  function close(code: Code): State | undefined {
    effects.exit("mathTextData");
    effects.enter("mathTextSequence");
    effects.consume(code);
    return finish;
  }

  function finish(code: Code): State | undefined {
    effects.exit("mathTextSequence");
    effects.exit("mathText");
    return ok(code);
  }
};

const construct: Construct = {
  name: "dollarMathText",
  tokenize: tokenizeDollarMath,
  // Not directly after another `$` (that is `$$`), unless that one was escaped.
  previous(this: TokenizeContext, code: Code) {
    return code !== DOLLAR || this.events[this.events.length - 1]?.[1].type === "characterEscape";
  },
};

export const dollarMathExtension: Extension = { text: { [DOLLAR]: construct } };

/** A remark plugin: add after `remark-math` with `singleDollarTextMath: false`. */
export function remarkDollarMath(this: Processor): void {
  const data = this.data();
  const extensions = data.micromarkExtensions ?? (data.micromarkExtensions = []);
  extensions.push(dollarMathExtension);
}
