/**
 * arXiv adapter (Atom API). Docs: https://info.arxiv.org/help/api/user-manual.html
 *
 * arXiv sends no CORS headers, so this only works inside the desktop app
 * (requests go through the Rust-side HTTP plugin). There are no citation
 * counts; every paper has a PDF.
 */
import { fetchWithRetry } from "../core/net";
import { normalizeArxivId } from "./merge";
import type {
  Paper,
  PaperSource,
  SearchFilters,
  SearchOptions,
  SearchParams,
  SearchResult,
} from "./types";

const API = "https://export.arxiv.org/api/query";

const collapse = (text: string | null | undefined): string =>
  (text ?? "").replace(/\s+/g, " ").trim();

/**
 * Free text → arXiv query grammar. Words are ANDed (`all:` searches title,
 * abstract, authors…), "quoted phrases" stay together, and an upper-case OR /
 * NOT between terms is honoured. Characters the grammar treats specially are
 * stripped from the user's words rather than passed through.
 */
export function buildArxivQuery(query: string, filters?: SearchFilters): string {
  const parts: string[] = [];
  let op: "AND" | "OR" | "ANDNOT" = "AND";

  for (const match of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    const phrase = match[1];
    const word = match[2];
    if (word && /^(AND|OR|NOT)$/.test(word)) {
      op = word === "OR" ? "OR" : word === "NOT" ? "ANDNOT" : "AND";
      continue;
    }
    const text = collapse((phrase ?? word).replace(/[()[\]{}:"+\\^~*?!]/g, " "));
    if (!text) continue;
    const quoted = phrase != null || /[^A-Za-z0-9]/.test(text);
    if (parts.length > 0) parts.push(op);
    parts.push(quoted ? `all:"${text}"` : `all:${text}`);
    op = "AND";
  }

  if (parts.length === 0) return "";
  let q = parts.length > 1 ? `(${parts.join(" ")})` : parts[0];

  const from = filters?.yearFrom;
  const to = filters?.yearTo;
  if (from != null || to != null) {
    const start = String(from ?? 1991).padStart(4, "0");
    const end = String(to ?? new Date().getFullYear()).padStart(4, "0");
    q += ` AND submittedDate:[${start}01010000 TO ${end}12312359]`;
  }
  return q;
}

function text(el: Element, tag: string): string {
  return collapse(el.getElementsByTagName(tag)[0]?.textContent);
}

export interface ParsedFeed {
  papers: Paper[];
  total: number;
  start: number;
}

export function parseArxivFeed(xml: string): ParsedFeed {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("arXiv returned a response that could not be read.");
  }

  const papers: Paper[] = [];
  for (const entry of Array.from(doc.getElementsByTagName("entry"))) {
    const rawId = text(entry, "id");
    // arXiv reports query errors as a 200 with a single "Error" entry.
    if (rawId.includes("/api/errors")) {
      throw new Error(`arXiv: ${text(entry, "summary") || "the query was rejected"}`);
    }
    const arxivId = normalizeArxivId(rawId) ?? rawId.replace(/^.*\/abs\//, "").replace(/v\d+$/, "");
    const category = entry.getElementsByTagName("arxiv:primary_category")[0]?.getAttribute("term");
    const journalRef = text(entry, "arxiv:journal_ref");
    const published = text(entry, "published");
    const year = Number.parseInt(published.slice(0, 4), 10);

    papers.push({
      id: `arxiv:${arxivId}`,
      source: "arxiv",
      title: text(entry, "title") || "Untitled",
      authors: Array.from(entry.getElementsByTagName("author"))
        .map((a) => collapse(a.getElementsByTagName("name")[0]?.textContent))
        .filter(Boolean),
      year: Number.isFinite(year) ? year : null,
      venue: journalRef || (category ? `arXiv · ${category}` : "arXiv"),
      abstract: text(entry, "summary") || null,
      tldr: null,
      citationCount: null,
      url: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      doi: text(entry, "arxiv:doi") || null,
      arxivId,
    });
  }

  const num = (tag: string): number =>
    Number.parseInt(doc.getElementsByTagName(tag)[0]?.textContent ?? "", 10) || 0;
  return { papers, total: num("opensearch:totalResults"), start: num("opensearch:startIndex") };
}

export const arxiv: PaperSource = {
  id: "arxiv",
  name: "arXiv",
  shortName: "arXiv",

  async search(params: SearchParams, opts: SearchOptions = {}): Promise<SearchResult> {
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;
    const searchQuery = buildArxivQuery(params.query, params.filters);
    if (!searchQuery) return { papers: [], total: 0, offset, nextOffset: null };

    const url = new URL(API);
    url.searchParams.set("search_query", searchQuery);
    url.searchParams.set("start", String(offset));
    url.searchParams.set("max_results", String(limit));
    // arXiv can sort by date but has no citation data; "citations" falls back to relevance.
    url.searchParams.set("sortBy", params.sort === "newest" ? "submittedDate" : "relevance");
    url.searchParams.set("sortOrder", "descending");

    const res = await fetchWithRetry(url, { signal: opts.signal });
    if (res.status === 429) {
      throw new Error("Rate limited by arXiv. Wait a few seconds and try again.");
    }
    if (!res.ok) {
      throw new Error(`arXiv request failed (${res.status})`);
    }

    const { papers, total, start } = parseArxivFeed(await res.text());
    const consumed = start + papers.length;
    return {
      papers,
      total,
      offset: start,
      nextOffset: papers.length > 0 && consumed < total ? consumed : null,
    };
  },
};
