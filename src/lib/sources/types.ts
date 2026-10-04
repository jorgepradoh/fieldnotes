/**
 * Source-agnostic paper model and the adapter interface every paper source
 * (Semantic Scholar, arXiv, OpenAlex…) implements. Modules only ever see
 * `Paper` — never a source's raw response shape.
 */

/** A file stored in the local library (PDF or markdown) that backs a Paper. */
export interface LocalFileRef {
  /** Key into the blob store. */
  id: string;
  name: string;
  kind: "pdf" | "markdown";
  size: number;
}

export interface Paper {
  /** Source-prefixed, e.g. "s2:649def34f8be52c8b66281af98ae884c09aef38b". */
  id: string;
  source: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  /** One-sentence machine summary, when the source provides one. */
  tldr: string | null;
  citationCount: number | null;
  /** Landing page (browser). */
  url: string | null;
  /** Direct open-access PDF, when available. */
  pdfUrl: string | null;
  doi: string | null;
  arxivId: string | null;
  /**
   * Every source that returned this paper once results were merged, primary
   * first. Absent on papers straight from an adapter.
   */
  sources?: string[];
  /** Present for library items that carry a file stored by the app. */
  localFile?: LocalFileRef;
  /** The BibTeX key, for entries imported from a .bib file. */
  citekey?: string;
}

export type SortMode = "relevance" | "citations" | "newest";

export interface SearchFilters {
  yearFrom?: number;
  yearTo?: number;
  /** Papers with an unknown citation count never satisfy this. */
  minCitations?: number;
  /** Only papers with a direct open-access PDF link. */
  openAccessOnly?: boolean;
}

export interface SearchParams {
  query: string;
  limit?: number;
  offset?: number;
  filters?: SearchFilters;
  /**
   * Adapters apply what their API supports server-side and ignore the rest;
   * the merge layer sorts and filters again so the final list is always right.
   */
  sort?: SortMode;
}

export interface SearchOptions {
  signal?: AbortSignal;
  apiKey?: string;
  /** Contact address for APIs with a "polite pool" (OpenAlex). */
  email?: string;
}

export interface SearchResult {
  papers: Paper[];
  total: number;
  offset: number;
  /** Offset for the next page, or null when exhausted. */
  nextOffset: number | null;
}

export interface PaperSource {
  id: string;
  name: string;
  /** Compact label for badges. */
  shortName: string;
  search(params: SearchParams, opts?: SearchOptions): Promise<SearchResult>;
}
