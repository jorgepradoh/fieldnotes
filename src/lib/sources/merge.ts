/**
 * Combining results from several sources into one list: recognising the same
 * paper under different ids (DOI, arXiv id, title), merging their metadata,
 * fusing the per-source rankings, then filtering and sorting.
 */
import type { Paper, SearchFilters, SortMode } from "./types";

// ----------------------------------------------------------- identifiers

export function normalizeDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const cleaned = doi
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
  return /^10\.\d{4,9}\//.test(cleaned) ? cleaned : null;
}

/** "arXiv:2401.01234v2" / "https://arxiv.org/abs/2401.01234v2" → "2401.01234". */
export function normalizeArxivId(id: string | null | undefined): string | null {
  if (!id) return null;
  const cleaned = id
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf)\//, "")
    .replace(/^arxiv:\s*/, "")
    .replace(/\.pdf$/, "")
    .replace(/v\d+$/, "");
  return /^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})$/.test(cleaned) ? cleaned : null;
}

/** arXiv's own DataCite DOIs (10.48550/arXiv.2401.01234) carry the arXiv id. */
export function arxivIdFromDoi(doi: string | null | undefined): string | null {
  const normalized = normalizeDoi(doi);
  const match = normalized?.match(/^10\.48550\/arxiv\.(.+)$/);
  return match ? normalizeArxivId(match[1]) : null;
}

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function firstAuthorSurname(paper: Paper): string {
  const first = paper.authors[0];
  if (!first) return "";
  const surname = first.trim().split(/\s+/).pop() ?? "";
  return normalizeTitle(surname);
}

/** Every identity a paper can be recognised by. Shared key ⇒ same paper. */
export function paperKeys(paper: Paper): string[] {
  const keys: string[] = [];
  const doi = normalizeDoi(paper.doi);
  if (doi) keys.push(`doi:${doi}`);
  const arxiv = normalizeArxivId(paper.arxivId) ?? arxivIdFromDoi(paper.doi);
  if (arxiv) keys.push(`arxiv:${arxiv}`);

  const title = normalizeTitle(paper.title);
  // Long titles are distinctive on their own; short ones also need the first
  // author, so "A survey" by two different people does not collapse.
  if (title.length >= 25) keys.push(`title:${title}`);
  else if (title.length >= 8) {
    const surname = firstAuthorSurname(paper);
    if (surname) keys.push(`title:${title}:${surname}`);
  }
  return keys;
}

// --------------------------------------------------------------- merging

function isWeakVenue(venue: string | null): boolean {
  return !venue || /^arxiv\b/i.test(venue);
}

function pickNumber(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

/** Combine two records of the same paper. `primary` wins ties and keeps its id. */
export function mergePapers(primary: Paper, other: Paper): Paper {
  const abstractA = primary.abstract ?? "";
  const abstractB = other.abstract ?? "";
  const sources = [...(primary.sources ?? [primary.source])];
  for (const s of other.sources ?? [other.source]) {
    if (!sources.includes(s)) sources.push(s);
  }
  return {
    ...primary,
    title: primary.title || other.title,
    authors: primary.authors.length >= other.authors.length ? primary.authors : other.authors,
    year: primary.year ?? other.year,
    venue: isWeakVenue(primary.venue) && !isWeakVenue(other.venue) ? other.venue : (primary.venue ?? other.venue),
    abstract: abstractB.length > abstractA.length ? abstractB : primary.abstract,
    tldr: primary.tldr ?? other.tldr,
    citationCount: pickNumber(primary.citationCount, other.citationCount),
    url: primary.url ?? other.url,
    pdfUrl: primary.pdfUrl ?? other.pdfUrl,
    doi: primary.doi ?? other.doi,
    arxivId: primary.arxivId ?? other.arxivId,
    sources,
    localFile: primary.localFile ?? other.localFile,
  };
}

// ---------------------------------------------------------------- fusion

/**
 * Reciprocal Rank Fusion: each source contributes 1/(k + rank) for every paper
 * it returned, so a paper ranked well by several sources outranks one ranked
 * first by only one. Duplicates are merged on the way. `lists` should be
 * ordered by source preference — earlier lists win metadata ties.
 */
export function fuseRankings(lists: Paper[][], k = 60): Paper[] {
  interface Group {
    paper: Paper;
    score: number;
    firstSeen: number;
  }
  const groups: Group[] = [];
  const keyToGroup = new Map<string, Group>();
  let seen = 0;

  for (const list of lists) {
    // A source repeating a paper must not count twice toward its score.
    const counted = new Set<Group>();
    list.forEach((paper, rank) => {
      const keys = paperKeys(paper);
      const hits = new Set(keys.map((key) => keyToGroup.get(key)).filter((g): g is Group => !!g));

      let target: Group;
      if (hits.size === 0) {
        target = { paper: { ...paper, sources: paper.sources ?? [paper.source] }, score: 0, firstSeen: seen++ };
        groups.push(target);
      } else {
        const [first, ...rest] = [...hits].sort((a, b) => a.firstSeen - b.firstSeen);
        target = first;
        target.paper = mergePapers(target.paper, paper);
        // A paper can bridge two groups that looked distinct (e.g. one known
        // only by DOI, another only by arXiv id): fold them together.
        for (const other of rest) {
          target.paper = mergePapers(target.paper, other.paper);
          target.score += other.score;
          if (counted.delete(other)) counted.add(target);
          groups.splice(groups.indexOf(other), 1);
          for (const [key, g] of keyToGroup) if (g === other) keyToGroup.set(key, target);
        }
      }
      if (!counted.has(target)) {
        counted.add(target);
        target.score += 1 / (k + rank + 1);
      }
      for (const key of [...keys, ...paperKeys(target.paper)]) keyToGroup.set(key, target);
    });
  }

  return groups
    .sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
    .map((g) => g.paper);
}

// ------------------------------------------------- filtering and sorting

export function hasActiveFilters(f: SearchFilters | undefined): boolean {
  return !!f && (f.yearFrom != null || f.yearTo != null || (f.minCitations ?? 0) > 0 || !!f.openAccessOnly);
}

export function applyFilters(papers: Paper[], filters: SearchFilters | undefined): Paper[] {
  if (!hasActiveFilters(filters)) return papers;
  const { yearFrom, yearTo, minCitations, openAccessOnly } = filters ?? {};
  return papers.filter((p) => {
    if (yearFrom != null && (p.year == null || p.year < yearFrom)) return false;
    if (yearTo != null && (p.year == null || p.year > yearTo)) return false;
    if ((minCitations ?? 0) > 0 && (p.citationCount == null || p.citationCount < (minCitations ?? 0))) return false;
    if (openAccessOnly && !p.pdfUrl) return false;
    return true;
  });
}

/** Stable sort. "relevance" keeps the incoming (fused) order. Unknowns sort last. */
export function sortPapers(papers: Paper[], sort: SortMode): Paper[] {
  if (sort === "relevance") return papers;
  const indexed = papers.map((paper, index) => ({ paper, index }));
  const value = (p: Paper): number => (sort === "citations" ? (p.citationCount ?? -1) : (p.year ?? -1));
  indexed.sort((a, b) => value(b.paper) - value(a.paper) || a.index - b.index);
  return indexed.map((x) => x.paper);
}
