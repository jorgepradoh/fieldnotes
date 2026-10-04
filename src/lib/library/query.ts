/** Searching and ordering the library list. Pure, so the UI stays declarative. */
import type { Paper } from "../sources/types";

export type LibrarySort = "added" | "title" | "year" | "citations";

export const SORTS: { id: LibrarySort; label: string }[] = [
  { id: "added", label: "Recently added" },
  { id: "title", label: "Title" },
  { id: "year", label: "Year (newest)" },
  { id: "citations", label: "Most cited" },
];

function haystack(p: Paper): string {
  return [p.title, p.authors.join(" "), p.venue, p.year, p.doi, p.arxivId, p.citekey, p.abstract, p.localFile?.name]
    .filter((v) => v != null)
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase();
}

/** Every whitespace-separated term must appear somewhere (accent- and case-insensitive). */
export function matchesQuery(paper: Paper, query: string): boolean {
  const terms = query
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(paper);
  return terms.every((t) => text.includes(t));
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
