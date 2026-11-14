import { StateEffect } from "@codemirror/state";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { EditorView, type Panel, type ViewUpdate } from "@codemirror/view";

/** Shows the replace row of an open find widget (used by Replace / Ctrl+H). */
export const setReplaceVisible = StateEffect.define<boolean>();

/** Matches are counted up to this many, then shown as "999+". */
const COUNT_CAP = 999;
/** Documents longer than this have their match count debounced rather than computed inline. */
const SYNC_COUNT_LIMIT = 20_000;
const COUNT_DELAY_MS = 150;

const SVG_NS = "http://www.w3.org/2000/svg";

function icon(paths: string[]): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}

const ICONS = {
  chevron: ["M6 3.5 10.5 8 6 12.5"],
  up: ["M3.5 10 8 5.5l4.5 4.5"],
  down: ["M3.5 6 8 10.5 12.5 6"],
  close: ["M4 4l8 8M12 4l-8 8"],
  replace: ["M2.5 8h9", "M8.5 4.5 12 8l-3.5 3.5"],
  replaceAll: ["M2.5 5h9", "M8.5 1.5 12 5 8.5 8.5", "M2.5 12h9", "M8.5 8.5 12 12l-3.5 3.5"],
};

function button(
  className: string,
  label: string,
  svg: SVGElement | null,
  text?: string,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `cm-find-btn ${className}`.trim();
  b.title = label;
  b.setAttribute("aria-label", label);
  if (svg) b.append(svg);
  if (text) {
    const t = document.createElement("span");
    t.className = "cm-find-glyph";
    t.setAttribute("aria-hidden", "true");
    t.textContent = text;
    b.append(t);
  }
  return b;
}

function textField(name: string, label: string, placeholder: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.name = name;
  input.className = "cm-find-input";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.spellcheck = false;
  return input;
}

/** Counts matches (capped) and finds which one is selected. `index` is 0 when none is selected. */
export function countMatches(
  view: EditorView,
  query: SearchQuery,
): { total: number; index: number; capped: boolean } {
  let total = 0;
  let index = 0;
  let capped = false;
  if (!query.valid || !query.search) return { total, index, capped };
  const { from, to } = view.state.selection.main;
  const cursor = query.getCursor(view.state);
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    total++;
    if (step.value.from === from && step.value.to === to && !index) index = total;
    if (total >= COUNT_CAP) {
      capped = true;
      break;
    }
  }
  return { total, index, capped };
}

/** The compact floating find and replace widget, installed with `search({ createPanel })`. */
export function createFindPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-find";
  dom.setAttribute("role", "search");
  dom.setAttribute("aria-label", "Find and replace");

  const chevron = button("cm-find-chevron", "Toggle replace", icon(ICONS.chevron));
  chevron.setAttribute("aria-expanded", "false");

  const searchField = document.createElement("div");
  searchField.className = "cm-find-field";
  const searchInput = textField("search", "Find", "Find");
  searchInput.setAttribute("main-field", "true");
  const count = document.createElement("span");
  count.className = "cm-find-count";
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  const caseBtn = button("cm-find-toggle", "Match case (Alt+C)", null, "Aa");
  const wordBtn = button("cm-find-toggle cm-find-toggle-word", "Whole word (Alt+W)", null, "ab");
  const regexBtn = button("cm-find-toggle", "Regular expression (Alt+R)", null, ".*");
  for (const b of [caseBtn, wordBtn, regexBtn]) b.setAttribute("aria-pressed", "false");
  searchField.append(searchInput, count, caseBtn, wordBtn, regexBtn);

  const prevBtn = button("", "Previous match (Shift+Enter)", icon(ICONS.up));
  const nextBtn = button("", "Next match (Enter)", icon(ICONS.down));
  const closeBtn = button("cm-find-close", "Close (Escape)", icon(ICONS.close));

  const replaceField = document.createElement("div");
  replaceField.className = "cm-find-field cm-find-replace";
  const replaceInput = textField("replace", "Replace with", "Replace");
  replaceField.append(replaceInput);
  const replaceBtn = button("", "Replace (Enter)", icon(ICONS.replace));
  const replaceAllBtn = button("", "Replace all (Ctrl+Alt+Enter)", icon(ICONS.replaceAll));

  const spacerStart = document.createElement("span");
  const spacerEnd = document.createElement("span");
  const replaceNodes: HTMLElement[] = [
    spacerStart,
    replaceField,
    replaceBtn,
    replaceAllBtn,
    spacerEnd,
  ];
  dom.append(chevron, searchField, prevBtn, nextBtn, closeBtn, ...replaceNodes);

  let expanded = false;
  let caseOn = false;
  let wordOn = false;
  let regexOn = false;
  let countTimer: number | undefined;

  const setExpanded = (value: boolean): void => {
    expanded = value;
    chevron.setAttribute("aria-expanded", String(value));
    for (const node of replaceNodes) node.hidden = !value;
  };

  const setToggle = (btn: HTMLButtonElement, on: boolean): void => {
    btn.setAttribute("aria-pressed", String(on));
  };

  const queryFromUi = (): SearchQuery =>
    new SearchQuery({
      search: searchInput.value,
      replace: replaceInput.value,
      caseSensitive: caseOn,
      wholeWord: wordOn,
      regexp: regexOn,
    });

  const renderCount = (): void => {
    const query = getSearchQuery(view.state);
    let text = "";
    let error = false;
    if (query.search) {
      if (!query.valid) {
        text = "Invalid";
        error = true;
      } else {
        const { total, index, capped } = countMatches(view, query);
        if (total === 0) {
          text = "No results";
          error = true;
        } else if (index) {
          text = `${index} of ${total}${capped ? "+" : ""}`;
        } else {
          text = `${total}${capped ? "+" : ""} ${total === 1 && !capped ? "result" : "results"}`;
        }
      }
    }
    count.textContent = text;
    searchField.classList.toggle("is-error", error);
    searchInput.setAttribute("aria-invalid", String(error));
    if (query.search && !query.valid) {
      count.title = "Invalid regular expression";
      count.setAttribute("aria-label", "Invalid regular expression");
    } else {
      count.removeAttribute("title");
      count.removeAttribute("aria-label");
    }
  };

  const scheduleCount = (): void => {
    window.clearTimeout(countTimer);
    countTimer = undefined;
    if (view.state.doc.length <= SYNC_COUNT_LIMIT) {
      renderCount();
    } else {
      countTimer = window.setTimeout(renderCount, COUNT_DELAY_MS);
    }
  };

  /** Selects the first match at or after the caret, scrolling it into view, without focusing. */
  const selectFirstMatch = (query: SearchQuery): void => {
    if (!query.valid || !query.search) return;
    const { from } = view.state.selection.main;
    // The first match starting at or after the caret, wrapping to the start of the document.
    let step = query.getCursor(view.state, from).next();
    if (step.done && from > 0) step = query.getCursor(view.state, 0, from).next();
    if (step.done) return;
    const next = step.value;
    view.dispatch({
      selection: { anchor: next.from, head: next.to },
      effects: EditorView.scrollIntoView(next.from, { y: "nearest", yMargin: 48 }),
      userEvent: "select.search",
    });
  };

  const commit = (incremental: boolean): void => {
    const query = queryFromUi();
    if (!query.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(query) });
    if (incremental) selectFirstMatch(query);
    scheduleCount();
  };

  /** CodeMirror's find commands select the whole Find field afterwards; keep the caret instead. */
  const keepingFieldSelection = (run: () => void): void => {
    const start = searchInput.selectionStart;
    const end = searchInput.selectionEnd;
    run();
    if (document.activeElement === searchInput && start !== null && end !== null) {
      searchInput.setSelectionRange(start, end);
    }
  };

  const toggle = (which: "case" | "word" | "regex"): void => {
    if (which === "case") setToggle(caseBtn, (caseOn = !caseOn));
    else if (which === "word") setToggle(wordBtn, (wordOn = !wordOn));
    else setToggle(regexBtn, (regexOn = !regexOn));
    commit(true);
  };

  const syncFromState = (): void => {
    const q = getSearchQuery(view.state);
    if (searchInput.value !== q.search) searchInput.value = q.search;
    if (replaceInput.value !== q.replace) replaceInput.value = q.replace;
    caseOn = q.caseSensitive;
    wordOn = q.wholeWord;
    regexOn = q.regexp;
    setToggle(caseBtn, caseOn);
    setToggle(wordBtn, wordOn);
    setToggle(regexBtn, regexOn);
  };

  const doNext = (): void => keepingFieldSelection(() => void findNext(view));
  const doPrev = (): void => keepingFieldSelection(() => void findPrevious(view));
  const doReplace = (): void => void replaceNext(view);
  const doReplaceAll = (): void => void replaceAll(view);

  chevron.addEventListener("click", () => setExpanded(!expanded));
  searchInput.addEventListener("input", () => commit(true));
  replaceInput.addEventListener("input", () => commit(false));
  caseBtn.addEventListener("click", () => toggle("case"));
  wordBtn.addEventListener("click", () => toggle("word"));
  regexBtn.addEventListener("click", () => toggle("regex"));
  prevBtn.addEventListener("click", doPrev);
  nextBtn.addEventListener("click", doNext);
  closeBtn.addEventListener("click", () => void closeSearchPanel(view));
  replaceBtn.addEventListener("click", doReplace);
  replaceAllBtn.addEventListener("click", doReplaceAll);

  dom.addEventListener("keydown", (event) => {
    const target = event.target;
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearchPanel(view);
      return;
    }
    // Alt+C, Alt+W and Alt+R: by physical key, as Alt changes the character on some layouts.
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const which =
        event.code === "KeyC"
          ? "case"
          : event.code === "KeyW"
            ? "word"
            : event.code === "KeyR"
              ? "regex"
              : null;
      if (which) {
        event.preventDefault();
        toggle(which);
        return;
      }
    }
    if (event.key !== "Enter" || event.isComposing) return;
    if (event.ctrlKey && event.altKey) {
      event.preventDefault();
      doReplaceAll();
    } else if (target === searchInput) {
      event.preventDefault();
      if (event.altKey) selectMatches(view);
      else if (event.shiftKey) doPrev();
      else doNext();
    } else if (target === replaceInput) {
      event.preventDefault();
      doReplace();
    }
  });

  /** Keeps the widget clear of the vertical scrollbar, whatever width it has. */
  const placeBesideScrollbar = (): void => {
    const bar = view.scrollDOM.offsetWidth - view.scrollDOM.clientWidth;
    dom.style.setProperty("--find-scrollbar", `${Math.max(0, bar)}px`);
  };

  setExpanded(false);
  syncFromState();
  placeBesideScrollbar();
  scheduleCount();

  return {
    dom,
    top: true,
    mount() {
      searchInput.focus();
      searchInput.select();
      placeBesideScrollbar();
    },
    update(update: ViewUpdate) {
      let queryChanged = false;
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery)) queryChanged = true;
          else if (effect.is(setReplaceVisible) && effect.value) setExpanded(true);
        }
      }
      if (queryChanged) syncFromState();
      if (update.geometryChanged) placeBesideScrollbar();
      if (queryChanged || update.docChanged || update.selectionSet) scheduleCount();
    },
    destroy() {
      window.clearTimeout(countTimer);
    },
  };
}
