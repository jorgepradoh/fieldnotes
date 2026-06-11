/**
 * Source-agnostic paper model and the adapter interface every paper source
 * (Semantic Scholar, arXiv, OpenAlex…) implements. Modules only ever see
 * `Paper` — never a source's raw response shape.
 */

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
}

export interface SearchParams {
  query: string;
  limit?: number;
  offset?: number;
}

export interface SearchOptions {
  signal?: AbortSignal;
  apiKey?: string;
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
  search(params: SearchParams, opts?: SearchOptions): Promise<SearchResult>;
}
