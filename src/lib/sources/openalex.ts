/**
 * OpenAlex adapter. Docs: https://docs.openalex.org/api-entities/works
 *
 * Open, CORS-friendly, broad coverage (journals, preprints, books). An email
 * puts requests in the faster "polite pool"; an API key is sent when given,
 * for deployments that require one.
 */
import { fetchWithRetry } from "../core/net";
import { arxivIdFromDoi, normalizeArxivId, normalizeDoi } from "./merge";
import type {
  Paper,
  PaperSource,
  SearchFilters,
  SearchOptions,
  SearchParams,
  SearchResult,
} from "./types";

const API = "https://api.openalex.org";
const SELECT = [
  "id",
  "doi",
  "title",
  "display_name",
  "publication_year",
  "primary_location",
  "best_oa_location",
  "authorships",
  "abstract_inverted_index",
  "cited_by_count",
  "open_access",
].join(",");

interface OaLocation {
  landing_page_url?: string | null;
  pdf_url?: string | null;
  source?: { display_name?: string | null } | null;
}

export interface OpenAlexWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  primary_location?: OaLocation | null;
  best_oa_location?: OaLocation | null;
  authorships?: { author?: { display_name?: string | null } | null }[];
  abstract_inverted_index?: Record<string, number[]> | null;
  cited_by_count?: number | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null } | null;
}

interface OpenAlexResponse {
  meta?: { count?: number; page?: number; per_page?: number };
  results?: OpenAlexWork[];
}

/** OpenAlex ships abstracts as {word: [positions]}; rebuild the running text. */
export function abstractFromInvertedIndex(index: Record<string, number[]> | null | undefined): string | null {
  if (!index) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }
  const text = words.filter((w) => w !== undefined).join(" ").trim();
  return text || null;
}

export function mapOpenAlexWork(raw: OpenAlexWork): Paper {
  const doi = normalizeDoi(raw.doi);
  const arxivId =
    arxivIdFromDoi(raw.doi) ??
    [raw.best_oa_location?.landing_page_url, raw.best_oa_location?.pdf_url, raw.primary_location?.landing_page_url]
      .map((u) => normalizeArxivId(u))
      .find((id): id is string => !!id) ??
    null;
  const oaUrl = raw.open_access?.oa_url ?? null;

  return {
    id: `oa:${raw.id.replace(/^https?:\/\/openalex\.org\//, "")}`,
    source: "openalex",
    title: raw.title ?? raw.display_name ?? "Untitled",
    authors: (raw.authorships ?? [])
      .map((a) => a.author?.display_name ?? "")
      .filter(Boolean),
    year: raw.publication_year ?? null,
    venue: raw.primary_location?.source?.display_name || null,
    abstract: abstractFromInvertedIndex(raw.abstract_inverted_index),
    tldr: null,
    citationCount: raw.cited_by_count ?? null,
    url: raw.primary_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : raw.id),
    pdfUrl:
      raw.best_oa_location?.pdf_url ??
      (oaUrl && /\.pdf($|\?)/i.test(oaUrl) ? oaUrl : null),
    doi,
    arxivId,
  };
}

export function buildFilter(filters: SearchFilters | undefined): string {
  const parts: string[] = [];
  if (filters?.yearFrom != null) parts.push(`from_publication_date:${filters.yearFrom}-01-01`);
  if (filters?.yearTo != null) parts.push(`to_publication_date:${filters.yearTo}-12-31`);
  // `cited_by_count:>N` is strictly greater-than.
  if ((filters?.minCitations ?? 0) > 0) parts.push(`cited_by_count:>${(filters?.minCitations ?? 1) - 1}`);
  if (filters?.openAccessOnly) parts.push("open_access.is_oa:true");
  return parts.join(",");
}

export const openAlex: PaperSource = {
  id: "openalex",
  name: "OpenAlex",
  shortName: "OA",

  async search(params: SearchParams, opts: SearchOptions = {}): Promise<SearchResult> {
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;
    const page = Math.floor(offset / limit) + 1;

    const url = new URL(`${API}/works`);
    url.searchParams.set("search", params.query);
    url.searchParams.set("per-page", String(limit));
    url.searchParams.set("page", String(page));
    url.searchParams.set("select", SELECT);
    const filter = buildFilter(params.filters);
    if (filter) url.searchParams.set("filter", filter);
    if (params.sort === "citations") url.searchParams.set("sort", "cited_by_count:desc");
    else if (params.sort === "newest") url.searchParams.set("sort", "publication_date:desc");
    if (opts.email) url.searchParams.set("mailto", opts.email);
    if (opts.apiKey) url.searchParams.set("api_key", opts.apiKey);

    const res = await fetchWithRetry(url, { signal: opts.signal });
    if (res.status === 429) {
      throw new Error(
        "Rate limited by OpenAlex. Add your email (or an API key) in this module's settings for a higher limit.",
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("OpenAlex rejected the request. Check the API key in this module's settings.");
    }
    if (!res.ok) {
      throw new Error(`OpenAlex request failed (${res.status})`);
    }

    const body = (await res.json()) as OpenAlexResponse;
    const results = body.results ?? [];
    const total = body.meta?.count ?? 0;
    const consumed = (page - 1) * limit + results.length;
    return {
      papers: results.map(mapOpenAlexWork),
      total,
      offset: (page - 1) * limit,
      // OpenAlex only pages through the first 10,000 results.
      nextOffset: results.length > 0 && consumed < total && consumed < 10_000 ? consumed : null,
    };
  },
};
