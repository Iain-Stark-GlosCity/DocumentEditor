/**
 * The few things the Word export takes from YAML front matter: `title`, `author` and `date`. Front
 * matter is otherwise metadata, never body text. Anything unreadable is ignored.
 */
import type { Root } from "mdast";
import { parse } from "yaml";

export interface FrontMatter {
  title?: string;
  author?: string;
  date?: string;
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) {
    const parts = value.map(asText).filter((v): v is string => v !== undefined);
    return parts.length > 0 ? parts.join("; ") : undefined;
  }
  if (value !== null && typeof value === "object" && "name" in value) {
    return asText((value as { name: unknown }).name);
  }
  return undefined;
}

export function readFrontMatter(tree: Root): FrontMatter {
  const node = tree.children[0];
  if (node?.type !== "yaml") return {};
  let data: unknown;
  try {
    data = parse(node.value, { maxAliasCount: 50 });
  } catch {
    return {};
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return {};
  const record = data as Record<string, unknown>;
  const result: FrontMatter = {};
  const title = asText(record["title"]);
  const author = asText(record["author"] ?? record["authors"]);
  const date = asText(record["date"]);
  if (title !== undefined) result.title = title;
  if (author !== undefined) result.author = author;
  if (date !== undefined) result.date = date;
  return result;
}
