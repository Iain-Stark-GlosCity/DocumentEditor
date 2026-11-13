/** Does a keyboard event match a CodeMirror-style key such as `Mod-Shift-s`? */
export function matchesKey(event: KeyboardEvent, key: string): boolean {
  const parts = key.split("-");
  const wanted = (parts.pop() ?? "").toLowerCase();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  if (mods.has("mod") !== (event.ctrlKey || event.metaKey)) return false;
  if (mods.has("shift") !== event.shiftKey) return false;
  if (mods.has("alt") !== event.altKey) return false;
  return event.key.toLowerCase() === wanted;
}

/** Human-readable form of a key for labels, for example `Ctrl+Shift+S`. */
export function formatKey(key: string): string {
  return key
    .split("-")
    .map((p) => (p === "Mod" ? "Ctrl" : p.length === 1 ? p.toUpperCase() : p))
    .join("+");
}
