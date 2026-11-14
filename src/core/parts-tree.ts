/**
 * The parts of a container file as a tree for the Parts pane: pure data, no React. Folders come
 * first, then files, each in the order they first appear in the archive.
 */
import type { ContainerPart } from "../platform/platform";

export interface PartsNode {
  /** Unique and stable across re-listing: `dir:<path>` or `file:<name>`. */
  key: string;
  kind: "dir" | "file";
  /** Last path segment. */
  label: string;
  /** Full name inside the archive (a folder has no trailing slash). */
  path: string;
  /** 1 for top level. */
  depth: number;
  /** Key of the parent folder, or null at the top level. */
  parent: string | null;
  hasChildren: boolean;
  posInSet: number;
  setSize: number;
  /** Files only. */
  part?: ContainerPart;
}

interface Dir {
  path: string;
  dirs: Map<string, Dir>;
  files: ContainerPart[];
}

export function buildPartsTree(parts: readonly ContainerPart[]): PartsNode[] {
  const root: Dir = { path: "", dirs: new Map(), files: [] };
  for (const part of parts) {
    // Folder entries in the archive (`word/`) carry no content of their own.
    if (part.name === "" || part.name.endsWith("/")) continue;
    const segments = part.name.split("/").filter((s) => s !== "");
    segments.pop();
    let dir = root;
    for (const segment of segments) {
      let next = dir.dirs.get(segment);
      if (!next) {
        next = { path: dir.path ? `${dir.path}/${segment}` : segment, dirs: new Map(), files: [] };
        dir.dirs.set(segment, next);
      }
      dir = next;
    }
    dir.files.push(part);
  }

  const out: PartsNode[] = [];
  const walk = (dir: Dir, depth: number, parent: string | null) => {
    const setSize = dir.dirs.size + dir.files.length;
    let pos = 0;
    for (const [label, child] of dir.dirs) {
      const key = `dir:${child.path}`;
      out.push({
        key,
        kind: "dir",
        label,
        path: child.path,
        depth,
        parent,
        hasChildren: child.dirs.size + child.files.length > 0,
        posInSet: ++pos,
        setSize,
      });
      walk(child, depth + 1, key);
    }
    for (const part of dir.files) {
      out.push({
        key: `file:${part.name}`,
        kind: "file",
        label:
          part.name
            .split("/")
            .filter((s) => s !== "")
            .pop() ?? part.name,
        path: part.name,
        depth,
        parent,
        hasChildren: false,
        posInSet: ++pos,
        setSize,
        part,
      });
    }
  };
  walk(root, 1, null);
  return out;
}

/** Keys of the folders that contain a part, outermost first. */
export function ancestorKeys(partName: string): string[] {
  const segments = partName.split("/").filter((s) => s !== "");
  segments.pop();
  const keys: string[] = [];
  let path = "";
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment;
    keys.push(`dir:${path}`);
  }
  return keys;
}

/** The nodes to show: all matching files while filtering, else those not under a collapsed folder. */
export function visibleParts(
  nodes: readonly PartsNode[],
  collapsed: ReadonlySet<string>,
  filter: string,
): PartsNode[] {
  const wanted = filter.trim().toLowerCase();
  if (wanted) {
    return nodes.filter((n) => n.kind === "file" && n.path.toLowerCase().includes(wanted));
  }
  const hidden = new Set<string>();
  const out: PartsNode[] = [];
  for (const node of nodes) {
    if (node.parent !== null && (collapsed.has(node.parent) || hidden.has(node.parent))) {
      if (node.kind === "dir") hidden.add(node.key);
      continue;
    }
    out.push(node);
  }
  return out;
}

/** `0 B`, `812 B`, `1.5 KB`, `12 KB`, `3.2 MB`. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return `${text} ${units[unit]}`;
}
