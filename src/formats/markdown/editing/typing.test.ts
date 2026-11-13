import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { backspace, closeFenceOnEnter, deleteEmptyPair, enter, pasteUrl } from "./typing";
import {
  Harness,
  isOnFor,
  makeState,
  makeView,
  type Row,
  type Settings,
  toNotation,
  typeChar,
  viewNotation,
} from "./testing";

const views: EditorView[] = [];
function view(notation: string, settings: Settings = {}): EditorView {
  const v = makeView(notation, settings);
  views.push(v);
  return v;
}
afterEach(() => {
  while (views.length) views.pop()?.destroy();
});

function key(command: (t: Harness) => boolean, input: string, settings: Settings = {}) {
  const harness = new Harness(makeState(input, settings));
  const handled = command(harness);
  return { out: harness.notation, handled, harness };
}

describe("Enter (lang-markdown continuation, evaluated)", () => {
  const press = (input: string, settings: Settings = {}) =>
    key(enter(isOnFor(settings)), input, settings);

  it.each<Row>([
    ["continues a bullet", "- a^", "- a\n- ^"],
    ["continues a star bullet", "* a^", "* a\n* ^"],
    ["continues a task unchecked", "- [ ] a^", "- [ ] a\n- [ ] ^"],
    ["a checked task continues unchecked", "- [x] a^", "- [x] a\n- [ ] ^"],
    ["increments an ordered list", "1. a^", "1. a\n2. ^"],
    ["renumbers the items after it", "1. a^\n2. b\n3. c", "1. a\n2. ^\n3. b\n4. c"],
    ["splits the item at the cursor", "- ab^cd", "- ab\n- ^cd"],
    ["continues a blockquote", "> a^", "> a\n> ^"],
    ["a list in a blockquote", "> - a^", "> - a\n> - ^"],
    ["nested items keep their indent", "- a\n  - b^", "- a\n  - b\n  - ^"],
    ["an empty bullet ends the list", "- a\n- ^", "- a\n^"],
    ["an empty task ends the list", "- [ ] a\n- [ ] ^", "- [ ] a\n^"],
    ["an empty nested item outdents", "- a\n  - ^", "- a\n- ^"],
    ["an empty numbered item ends the list", "1. a\n2. ^", "1. a\n^"],
    ["CJK and emoji items", "- 你好😀^", "- 你好😀\n- ^"],
  ])("%s", (_name, input, expected) => {
    expect(press(input).out).toBe(expected);
  });

  it("declines on plain lines and in code so the default newline applies", () => {
    expect(press("plain^").handled).toBe(false);
    expect(press("```\n- a^\n```").handled).toBe(false);
  });

  it("is a single transaction and never writes CRLF", () => {
    const { harness } = press("- a^");
    expect(harness.transactions).toHaveLength(1);
    expect(harness.state.doc.toString()).not.toContain("\r");
  });

  it("is switched off by markdown.continueMarkup", () => {
    expect(press("- a^", { "markdown.continueMarkup": false }).handled).toBe(false);
  });
});

describe("Enter after an opening fence", () => {
  const press = (input: string, settings: Settings = {}) =>
    key(enter(isOnFor(settings)), input, settings);

  it.each<Row>([
    ["closes the fence", "```^", "```\n^\n```"],
    ["keeps the info string", "```js^", "```js\n^\n```"],
    ["longer fences", "````^", "````\n^\n````"],
    ["tilde fences", "~~~^", "~~~\n^\n~~~"],
    ["indented fences", "  ```^", "  ```\n  ^\n  ```"],
    ["text after the block stays", "```^\nlater", "```\n^\n```\nlater"],
  ])("%s", (_name, input, expected) => {
    expect(press(input).out).toBe(expected);
  });

  it("does nothing on a closing fence, or when the cursor is not at the end", () => {
    expect(press("```\ncode\n```^").handled).toBe(false);
    expect(press("`^``").handled).toBe(false);
    expect(closeFenceOnEnter(new Harness(makeState("```\ncode\n```^")))).toBe(false);
  });

  it("does nothing on an opener that already has its closer", () => {
    expect(press("```^\ncode\n```").handled).toBe(false);
  });

  it("is switched off by markdown.autoFence", () => {
    expect(press("```^", { "markdown.autoFence": false }).handled).toBe(false);
  });
});

describe("Backspace", () => {
  const press = (input: string, settings: Settings = {}) =>
    key(backspace(isOnFor(settings)), input, settings);

  it.each<Row>([
    ["removes a bullet marker first", "- ^a", "^a"],
    ["a task marker, box included", "- [ ] ^a", "^a"],
    ["a numbered marker", "1. ^a", "^a"],
    ["a blockquote marker", "> ^a", "^a"],
    ["an empty bullet", "- ^", "^"],
    ["a nested list marker becomes spaces first", "- a\n  - ^b", "- a\n  ^b"],
    ["an empty pair", "(^)", "^"],
    ["an empty bracket pair", "[^]", "^"],
    ["an empty quote pair", '"^"', "^"],
    ["an empty code pair", "`^`", "^"],
    ["several empty pairs", "(^) [^]", "^ ^"],
  ])("%s", (_name, input, expected) => {
    expect(press(input).out).toBe(expected);
  });

  it("declines mid-text and with a selection", () => {
    expect(press("fo^o").handled).toBe(false);
    expect(press("(a^)").handled).toBe(false);
    expect(press("|(|)").handled).toBe(false);
    expect(deleteEmptyPair(new Harness(makeState("(|a|)")))).toBe(false);
  });

  it("each switch turns off its own behaviour", () => {
    expect(press("(^)", { "markdown.autoPair": false }).handled).toBe(false);
    expect(press("- ^a", { "markdown.continueMarkup": false }).handled).toBe(false);
    expect(press("(^)", { "markdown.continueMarkup": false }).handled).toBe(true);
  });
});

describe("typing with a selection wraps it", () => {
  it.each<[string, string, string]>([
    ["*", "|foo|", "*|foo|*"],
    ["_", "|foo|", "_|foo|_"],
    ["`", "|foo|", "`|foo|`"],
    ["~", "|foo|", "~|foo|~"],
    ["[", "|foo|", "[|foo|]"],
    ["(", "|foo|", "(|foo|)"],
    ['"', "|foo|", '"|foo|"'],
    ["*", "a |b| c", "a *|b|* c"],
    ["*", "|a| |b|", "*|a|* *|b|*"],
    ["*", "|😀|", "*|😀|*"],
    ["*", "|你好|", "*|你好|*"],
    ["*", "|a\nb|", "*|a\nb|*"],
  ])("%s over %s", (char, input, expected) => {
    const v = view(input);
    expect(typeChar(v, char)).toBe(true);
    expect(viewNotation(v)).toBe(expected);
  });

  it("typing twice makes bold", () => {
    const v = view("|foo|");
    typeChar(v, "*");
    typeChar(v, "*");
    expect(viewNotation(v)).toBe("**|foo|**");
  });

  it("is one transaction per keystroke", () => {
    const v = view("|foo|");
    let count = 0;
    const original = v.dispatch.bind(v);
    v.dispatch = ((...args: Parameters<typeof v.dispatch>) => {
      count++;
      return original(...args);
    }) as typeof v.dispatch;
    typeChar(v, "*");
    expect(count).toBe(1);
  });

  it("other characters replace the selection as usual", () => {
    const v = view("|foo|");
    expect(typeChar(v, "x")).toBe(false);
    expect(viewNotation(v)).toBe("x^");
  });

  it("does not wrap inside code", () => {
    const v = view("```\n|foo|\n```");
    expect(typeChar(v, "(")).toBe(false);
    expect(viewNotation(v)).toBe("```\n(^\n```");
  });

  it("is switched off by markdown.autoPair", () => {
    const v = view("|foo|", { "markdown.autoPair": false });
    expect(typeChar(v, "*")).toBe(false);
    expect(viewNotation(v)).toBe("*^");
  });
});

describe("typing with no selection", () => {
  it.each<[string, string, string]>([
    ["(", "^", "(^)"],
    ["[", "^", "[^]"],
    ['"', "^", '"^"'],
    ["`", "^", "`^`"],
    ["(", "a ^ b", "a (^) b"],
    ["(", "a^", "a(^)"],
    ["(", "^)", "(^))"],
    ["(", "^\nfoo", "(^)\nfoo"],
  ])("pairs %s in %s", (char, input, expected) => {
    const v = view(input);
    expect(typeChar(v, char)).toBe(true);
    expect(viewNotation(v)).toBe(expected);
  });

  it.each<[string, string]>([
    ["*", "a^"],
    ["_", "a^"],
    ["~", "a^"],
    ["(", "^foo"],
    ["[", "a^b"],
    ['"', "it^"],
    ['"', "^foo"],
    ["`", "a^b"],
    ["(", "\\^"],
    ["x", "a^"],
    [")", "a^"],
  ])("leaves %s alone in %s", (char, input) => {
    const v = view(input);
    expect(typeChar(v, char)).toBe(false);
  });

  it("opens a quote after a space or punctuation but not after a word", () => {
    expect(typeChar(view("say ^"), '"')).toBe(true);
    expect(typeChar(view("say(^)"), '"')).toBe(true);
    expect(typeChar(view("5^"), '"')).toBe(false);
  });

  it("steps over the closer it inserted", () => {
    const v = view("^");
    typeChar(v, "(");
    typeChar(v, "a");
    expect(typeChar(v, ")")).toBe(true);
    expect(viewNotation(v)).toBe("(a)^");
  });

  it("steps over quotes and backticks it inserted", () => {
    for (const ch of ['"', "`", "["]) {
      const v = view("^");
      typeChar(v, ch);
      typeChar(v, "x");
      typeChar(v, ch === "[" ? "]" : ch);
      expect(viewNotation(v)).toBe(`${ch}x${ch === "[" ? "]" : ch}^`);
    }
  });

  it("does not step over a closer it did not insert", () => {
    const v = view("(a^)");
    expect(typeChar(v, ")")).toBe(false);
    expect(viewNotation(v)).toBe("(a)^)");
  });

  it("still steps over after typing before the closer moved it", () => {
    const v = view("^");
    typeChar(v, "(");
    typeChar(v, "a");
    typeChar(v, "b");
    typeChar(v, ")");
    expect(viewNotation(v)).toBe("(ab)^");
  });

  it("typing three backticks gives a bare fence opener, not a pair", () => {
    const v = view("^");
    typeChar(v, "`");
    typeChar(v, "`");
    typeChar(v, "`");
    expect(viewNotation(v)).toBe("```^");
  });

  it("does not pair inside a code block or inline code", () => {
    expect(typeChar(view("```\n^\n```"), "(")).toBe(false);
    expect(typeChar(view("`a^b`"), "(")).toBe(false);
  });

  it("pairs at every cursor", () => {
    const v = view("^ ^");
    expect(typeChar(v, "(")).toBe(true);
    expect(viewNotation(v)).toBe("(^) (^)");
  });

  it("mixes wrapping and pairing across selections", () => {
    const v = view("|a| ^");
    expect(typeChar(v, "(")).toBe(true);
    expect(viewNotation(v)).toBe("(|a|) (^)");
  });

  it("is switched off by markdown.autoPair", () => {
    const v = view("^", { "markdown.autoPair": false });
    expect(typeChar(v, "(")).toBe(false);
    expect(viewNotation(v)).toBe("(^");
  });
});

describe("pasting a URL", () => {
  it("over a selection makes a link", () => {
    const v = view("see |docs| now");
    expect(pasteUrl(v, "https://example.com")).toBe(true);
    expect(viewNotation(v)).toBe("see [docs](https://example.com)^ now");
  });

  it("trims whitespace and CRLF from the clipboard text", () => {
    const v = view("|docs|");
    pasteUrl(v, "  https://example.com\r\n");
    expect(v.state.doc.toString()).toBe("[docs](https://example.com)");
  });

  it("with no selection is left to the editor", () => {
    expect(pasteUrl(view("a^"), "https://example.com")).toBe(false);
  });

  it("leaves other text alone, even with a selection", () => {
    expect(pasteUrl(view("|a|"), "hello world")).toBe(false);
    expect(pasteUrl(view("|a|"), "https://a.com and more")).toBe(false);
  });

  it("does not link inside code or across lines", () => {
    expect(pasteUrl(view("```\n|a|\n```"), "https://example.com")).toBe(false);
    expect(pasteUrl(view("|a\nb|"), "https://example.com")).toBe(false);
  });

  it("links every selected range", () => {
    const v = view("|a| |b|");
    pasteUrl(v, "https://x.io");
    expect(v.state.doc.toString()).toBe("[a](https://x.io) [b](https://x.io)");
  });

  it("is one undo step", () => {
    const v = view("|docs|");
    let count = 0;
    const original = v.dispatch.bind(v);
    v.dispatch = ((...args: Parameters<typeof v.dispatch>) => {
      count++;
      return original(...args);
    }) as typeof v.dispatch;
    pasteUrl(v, "https://example.com");
    expect(count).toBe(1);
  });

  const paste = (v: EditorView, plain: string, html?: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        getData: (type: string) => (type === "text/plain" ? plain : (html ?? "")),
        types: ["text/plain"],
        files: [],
        items: [],
      },
    });
    v.contentDOM.dispatchEvent(event);
    return { prevented: event.defaultPrevented };
  };

  it("through the DOM handler: URL over a selection", () => {
    const v = view("|docs|");
    expect(paste(v, "https://example.com", "<a href='https://example.com'>x</a>").prevented).toBe(
      true,
    );
    expect(v.state.doc.toString()).toBe("[docs](https://example.com)");
  });

  it("through the DOM handler: HTML clipboard content is left to paste as plain text", () => {
    const v = view("|docs|");
    paste(v, "just text", "<b>just text</b>");
    expect(v.state.doc.toString()).toBe("just text");
  });

  it("through the DOM handler: a URL with no selection is pasted plainly", () => {
    const v = view("a^");
    paste(v, "https://example.com");
    expect(v.state.doc.toString()).toBe("ahttps://example.com");
  });

  it("through the DOM handler: switched off by markdown.pasteUrlAsLink", () => {
    const v = view("|docs|", { "markdown.pasteUrlAsLink": false });
    paste(v, "https://example.com");
    expect(v.state.doc.toString()).toBe("https://example.com");
  });
});

describe("state", () => {
  it("serialises to the notation", () => {
    expect(toNotation(makeState("a |b| ^c"))).toBe("a |b| ^c");
  });
});
