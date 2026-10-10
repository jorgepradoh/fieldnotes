/** Searching and ordering the library list. Pure, so the UI stays declarative. */
import type { Paper } from "../sources/types";
import type { LibraryEntry, PaperStatus } from "./model";

export type LibrarySort = "added" | "title" | "year" | "citations";

export const SORTS: { id: LibrarySort; label: string }[] = [
  { id: "added", label: "Recently added" },
  { id: "title", label: "Title" },
  { id: "year", label: "Year (newest)" },
  { id: "citations", label: "Most cited" },
];

function haystack(p: Paper, tags: readonly string[]): string {
  return [p.title, p.authors.join(" "), p.venue, p.year, p.doi, p.arxivId, p.citekey, p.abstract, p.localFile?.name, ...tags]
    .filter((v) => v != null)
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase();
}

/** Every whitespace-separated term must appear somewhere, tags included (accent- and case-insensitive). */
export function matchesQuery(paper: Paper, query: string, tags: readonly string[] = []): boolean {
  const terms = query
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(paper, tags);
  return terms.every((t) => text.includes(t));
}

/** "all" shows everything, "none" the papers that are not queued, otherwise one reading status. */
export type StatusFilter = "all" | "none" | PaperStatus;

export interface EntryFilter {
  query: string;
  status: StatusFilter;
  /** Only papers carrying this tag, or null for any. */
  tag: string | null;
}

export function matchesEntry(entry: LibraryEntry, filter: EntryFilter): boolean {
  if (filter.status === "none" ? entry.status !== undefined : filter.status !== "all" && entry.status !== filter.status) return false;
  if (filter.tag !== null && !entry.tags?.includes(filter.tag)) return false;
  return matchesQuery(entry.paper, filter.query, entry.tags);
}

export interface Row {
  paper: Paper;
  addedAt: number;
}

export function sortRows<T extends Row>(rows: T[], sort: LibrarySort): T[] {
  const copy = [...rows];
  const cmp: Record<LibrarySort, (a: T, b: T) => number> = {
    added: (a, b) => b.addedAt - a.addedAt,
    title: (a, b) => a.paper.title.localeCompare(b.paper.title, undefined, { sensitivity: "base", numeric: true }),
    year: (a, b) => (b.paper.year ?? -1) - (a.paper.year ?? -1),
    citations: (a, b) => (b.paper.citationCount ?? -1) - (a.paper.citationCount ?? -1),
  };
  // Array.prototype.sort is stable, so ties keep the "recently added" order they came in with.
  return copy.sort((a, b) => cmp[sort](a, b) || b.addedAt - a.addedAt);
}
