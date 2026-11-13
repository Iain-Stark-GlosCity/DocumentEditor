import type { Command } from "../core/commands";

interface ParsedKey {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** Parses CodeMirror-style notation such as `Mod-Shift-s`, `F1` or `Mod--` (Ctrl and minus). */
function parseKey(notation: string): ParsedKey {
  const parsed: ParsedKey = { mod: false, shift: false, alt: false, key: "" };
  let rest = notation;
  for (;;) {
    const match = /^(mod|shift|alt)-(?=.)/i.exec(rest);
    if (!match) break;
    const name = (match[1] ?? "").toLowerCase();
    if (name === "mod") parsed.mod = true;
    else if (name === "shift") parsed.shift = true;
    else parsed.alt = true;
    rest = rest.slice(match[0].length);
  }
  parsed.key = rest.toLowerCase();
  return parsed;
}

/** Does a keyboard event match a CodeMirror-style key such as `Mod-Shift-s`? */
export function matchesKey(event: KeyboardEvent, notation: string): boolean {
  const wanted = parseKey(notation);
  if (wanted.mod !== (event.ctrlKey || event.metaKey)) return false;
  if (wanted.shift !== event.shiftKey) return false;
  if (wanted.alt !== event.altKey) return false;
  return event.key.toLowerCase() === wanted.key;
}

/** Human-readable form of a key for labels, for example `Ctrl+Shift+S`. */
export function formatKey(notation: string): string {
  const parsed = parseKey(notation);
  const key =
    parsed.key.length === 1
      ? parsed.key.toUpperCase()
      : notation.slice(notation.length - parsed.key.length);
  return [parsed.mod && "Ctrl", parsed.shift && "Shift", parsed.alt && "Alt", key]
    .filter(Boolean)
    .join("+");
}

/** The keys a command answers to, primary first. */
export function commandKeys(command: Command): string[] {
  return [...(command.defaultKey ? [command.defaultKey] : []), ...(command.altKeys ?? [])];
}
