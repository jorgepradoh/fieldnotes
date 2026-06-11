/**
 * Semantic Scholar Academic Graph adapter.
 * Docs: https://api.semanticscholar.org/api-docs/graph
 * Works without a key (shared rate pool, expect occasional 429s);
 * a free key via x-api-key lifts the limit.
 */
import type { Paper, PaperSource, SearchOptions, SearchParams, SearchResult } from "./types";

const API = "https://api.semanticscholar.org/graph/v1";
const FIELDS =
  "title,abstract,year,venue,citationCount,authors,tldr,externalIds,openAccessPdf,url";

interface S2Author {
  name: string;
}

export interface S2Paper {
  paperId: string;
  title: string;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  citationCount?: number | null;
  url?: string | null;
  authors?: S2Author[];
  tldr?: { text?: string | null } | null;
  externalIds?: Record<string, string | number> | null;
  openAccessPdf?: { url?: string | null } | null;
}

interface S2SearchResponse {
  total?: number;
  offset?: number;
  next?: number;
  data?: S2Paper[];
}

export function mapS2Paper(raw: S2Paper): Paper {
  const doi = raw.externalIds?.DOI;
  const arxivId = raw.externalIds?.ArXiv;
  return {
    id: `s2:${raw.paperId}`,
    source: "semantic-scholar",
    title: raw.title,
    authors: (raw.authors ?? []).map((a) => a.name),
    year: raw.year ?? null,
    venue: raw.venue || null,
    abstract: raw.abstract ?? null,
    tldr: raw.tldr?.text ?? null,
    citationCount: raw.citationCount ?? null,
    url: raw.url ?? null,
    pdfUrl: raw.openAccessPdf?.url ?? null,
    doi: doi != null ? String(doi) : null,
    arxivId: arxivId != null ? String(arxivId) : null,
  };
}

export const semanticScholar: PaperSource = {
  id: "semantic-scholar",
  name: "Semantic Scholar",

  async search(params: SearchParams, opts: SearchOptions = {}): Promise<SearchResult> {
    const url = new URL(`${API}/paper/search`);
    url.searchParams.set("query", params.query);
    url.searchParams.set("limit", String(params.limit ?? 20));
    url.searchParams.set("offset", String(params.offset ?? 0));
    url.searchParams.set("fields", FIELDS);

    const headers: Record<string, string> = {};
    if (opts.apiKey) headers["x-api-key"] = opts.apiKey;

    const res = await fetch(url, { headers, signal: opts.signal });
    if (res.status === 429) {
      throw new Error(
        "Rate limited by Semantic Scholar. Wait a moment and retry — or add a free API key in this module's settings.",
      );
    }
    if (!res.ok) {
      throw new Error(`Semantic Scholar request failed (${res.status})`);
    }

    const body = (await res.json()) as S2SearchResponse;
    return {
      papers: (body.data ?? []).map(mapS2Paper),
      total: body.total ?? 0,
      offset: body.offset ?? 0,
      nextOffset: body.next ?? null,
    };
  },
};
