import { httpFetch, isAbortError } from "$lib/core/net";
import type { Paper, PaperSource, SearchOptions, SearchParams, SearchResult } from "./types";

// Zotero local API — Zotero must be running with its connector enabled.
// Endpoints mirror the web API but are served at localhost:23119.
// Pass 0 as the user ID to refer to the locally logged-in user's personal library.
const BASE = "http://localhost:23119/api";
const LIBRARY = `${BASE}/users/0`;

interface ZoteroCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

interface ZoteroItemData {
  key: string;
  itemType: string;
  title?: string;
  creators?: ZoteroCreator[];
  date?: string;
  abstractNote?: string;
  publicationTitle?: string;
  series?: string;
  DOI?: string;
  url?: string;
  extra?: string;
}

interface ZoteroItem {
  key: string;
  data: ZoteroItemData;
}

async function zoteroGet(url: string, signal?: AbortSignal): Promise<string> {
  const res = await httpFetch(url, { signal });
  if (!res.ok) throw new Error(`Zotero request failed (${res.status})`);
  return res.text();
}

async function pingZotero(signal?: AbortSignal): Promise<boolean> {
  try {
    await zoteroGet(`${LIBRARY}/items?limit=0&format=json`, signal);
    return true;
  } catch (err) {
    // A cancelled search is not "Zotero isn't running".
    if (isAbortError(err)) throw err;
    return false;
  }
}

function extractArxivId(extra: string): string | null {
  const m = extra.match(/arxiv[:\s]+([^\s\n]+)/i);
  return m ? m[1].replace(/v\d+$/, "") : null;
}

function formatAuthor(c: ZoteroCreator): string {
  if (c.firstName && c.lastName) return `${c.lastName}, ${c.firstName}`;
  if (c.lastName) return c.lastName;
  return c.name ?? "";
}

function parseYear(date: string): number | null {
  const m = date.match(/\b(\d{4})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function itemToPaper(item: ZoteroItem): Paper {
  const d = item.data;
  const authors = (d.creators ?? [])
    .filter((c) => c.creatorType === "author")
    .map(formatAuthor)
    .filter(Boolean);
  const year = d.date ? parseYear(d.date) : null;
  const arxivId = d.extra ? extractArxivId(d.extra) : null;
  const venue = d.publicationTitle ?? d.series ?? null;

  let pdfUrl: string | null = null;
  if (arxivId) pdfUrl = `https://arxiv.org/pdf/${arxivId}`;

  return {
    id: `zotero:${item.key}`,
    source: "zotero",
    title: d.title ?? "(untitled)",
    authors,
    year,
    venue,
    abstract: d.abstractNote ?? null,
    tldr: null,
    citationCount: null,
    url: d.url ?? (arxivId ? `https://arxiv.org/abs/${arxivId}` : null),
    pdfUrl,
    doi: d.DOI ?? null,
    arxivId,
  };
}

export const zotero: PaperSource = {
  id: "zotero",
  name: "Zotero",
  shortName: "Zotero",

  async search(params: SearchParams, opts: SearchOptions = {}): Promise<SearchResult> {
    const running = await pingZotero(opts.signal);
    if (!running) {
      throw new Error("Zotero is not running. Open Zotero and try again.");
    }

    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;

    const url = new URL(`${LIBRARY}/items`);
    url.searchParams.set("q", params.query);
    url.searchParams.set("format", "json");
    url.searchParams.set("include", "data");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("start", String(offset));

    const text = await zoteroGet(url.toString(), opts.signal);
    const items = JSON.parse(text) as ZoteroItem[];
    const papers = items.map(itemToPaper);

    // Zotero local API doesn't return a total-results count in JSON format.
    // Assume there are more results if we got a full page.
    const nextOffset = papers.length === limit ? offset + limit : null;

    return { papers, total: papers.length + offset, offset, nextOffset };
  },
};
