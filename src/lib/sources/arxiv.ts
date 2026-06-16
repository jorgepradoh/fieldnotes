import { fetchText } from "$lib/core/net";
import type { Paper, PaperSource, SearchOptions, SearchParams, SearchResult } from "./types";

const ATOM = "http://www.w3.org/2005/Atom";
const OPENSEARCH = "http://a9.com/-/spec/opensearch/1.1/";
const ARXIV_NS = "http://arxiv.org/schemas/atom";

function textNS(el: Element | Document, ns: string, tag: string): string {
  return el.getElementsByTagNameNS(ns, tag)[0]?.textContent?.trim() ?? "";
}

function parseEntry(entry: Element): Paper | null {
  const rawId = textNS(entry, ATOM, "id");
  // arXiv uses this URL pattern for invalid query responses
  if (rawId.includes("/api/errors")) return null;

  // Strip version suffix: http://arxiv.org/abs/2301.00001v2 → 2301.00001
  const arxivId =
    rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "") || null;

  const title = textNS(entry, ATOM, "title").replace(/\s+/g, " ") || rawId;
  const authors = Array.from(entry.getElementsByTagNameNS(ATOM, "author"))
    .map((a) => textNS(a, ATOM, "name"))
    .filter(Boolean);
  const abstract = textNS(entry, ATOM, "summary").replace(/\s+/g, " ") || null;

  const published = textNS(entry, ATOM, "published");
  const yearNum = published ? parseInt(published.slice(0, 4), 10) : NaN;
  const year = isNaN(yearNum) ? null : yearNum;

  let url: string | null = null;
  let pdfUrl: string | null = null;
  for (const link of Array.from(entry.getElementsByTagNameNS(ATOM, "link"))) {
    const rel = link.getAttribute("rel");
    const href = link.getAttribute("href") ?? "";
    if (rel === "alternate") url = href;
    if (rel === "related" && link.getAttribute("title") === "pdf") pdfUrl = href;
  }

  const doi = textNS(entry, ARXIV_NS, "doi") || null;
  const category =
    entry
      .getElementsByTagNameNS(ARXIV_NS, "primary_category")[0]
      ?.getAttribute("term") ?? null;

  return {
    id: `arxiv:${arxivId ?? rawId}`,
    source: "arxiv",
    title,
    authors,
    year,
    venue: category,
    abstract,
    tldr: null,
    citationCount: null,
    url,
    pdfUrl,
    doi,
    arxivId,
  };
}

export function parseAtomXml(xml: string, offset: number, limit: number): SearchResult {
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  const totalStr =
    doc.getElementsByTagNameNS(OPENSEARCH, "totalResults")[0]?.textContent ?? "0";
  const total = parseInt(totalStr, 10) || 0;

  const entries = Array.from(doc.getElementsByTagNameNS(ATOM, "entry"));
  const papers = entries.map(parseEntry).filter((p): p is Paper => p !== null);

  const nextOffset = offset + papers.length < total ? offset + limit : null;
  return { papers, total, offset, nextOffset };
}

export const arxiv: PaperSource = {
  id: "arxiv",
  name: "arXiv",

  async search(params: SearchParams, opts: SearchOptions = {}): Promise<SearchResult> {
    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("search_query", `all:${params.query}`);
    url.searchParams.set("start", String(params.offset ?? 0));
    url.searchParams.set("max_results", String(params.limit ?? 20));
    url.searchParams.set("sortBy", "relevance");

    const xml = await fetchText(url.toString(), { signal: opts.signal });
    return parseAtomXml(xml, params.offset ?? 0, params.limit ?? 20);
  },
};
