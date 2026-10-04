import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SOURCE_IDS, SOURCES, getSource } from "./index";
import { zotero } from "./zotero";

const item = {
  key: "ABCD1234",
  data: {
    key: "ABCD1234",
    itemType: "journalArticle",
    title: "Attention Is All You Need",
    creators: [
      { creatorType: "author", firstName: "Ashish", lastName: "Vaswani" },
      { creatorType: "editor", firstName: "Not", lastName: "AnAuthor" },
      { creatorType: "author", name: "Google Brain" },
    ],
    date: "2017-06-12",
    abstractNote: "The dominant sequence transduction models...",
    publicationTitle: "NeurIPS",
    DOI: "10.5555/3295222.3295349",
    extra: "arXiv: 1706.03762v7",
  },
};

describe("zotero.search", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The first reply answers the "is Zotero running?" ping, the second the real query. */
  function stub(...replies: unknown[]) {
    const fn = vi.fn(async (..._args: unknown[]) => {
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply ?? []), { status: 200 });
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("maps a Zotero item to a Paper", async () => {
    stub([], [item]);
    const { papers } = await zotero.search({ query: "attention", limit: 20 });
    expect(papers).toEqual([
      {
        id: "zotero:ABCD1234",
        source: "zotero",
        title: "Attention Is All You Need",
        authors: ["Vaswani, Ashish", "Google Brain"],
        year: 2017,
        venue: "NeurIPS",
        abstract: "The dominant sequence transduction models...",
        tldr: null,
        citationCount: null,
        url: "https://arxiv.org/abs/1706.03762",
        pdfUrl: "https://arxiv.org/pdf/1706.03762",
        doi: "10.5555/3295222.3295349",
        arxivId: "1706.03762",
      },
    ]);
  });

  it("asks the local API for the right page and offers the next one only after a full page", async () => {
    const fn = stub([], [item, item]);
    const full = await zotero.search({ query: "attention", limit: 2, offset: 4 });
    const url = new URL(String(fn.mock.calls[1][0]));
    expect(url.origin + url.pathname).toBe("http://localhost:23119/api/users/0/items");
    expect(url.searchParams.get("q")).toBe("attention");
    expect(url.searchParams.get("limit")).toBe("2");
    expect(url.searchParams.get("start")).toBe("4");
    expect(full.nextOffset).toBe(6);

    stub([], [item]);
    expect((await zotero.search({ query: "attention", limit: 2 })).nextOffset).toBeNull();
  });

  it("says Zotero is not running when the local API can't be reached", async () => {
    stub(new TypeError("fetch failed"));
    await expect(zotero.search({ query: "x" })).rejects.toThrow("Zotero is not running");
  });

  it("lets a cancelled search surface as an abort, not as 'not running'", async () => {
    stub(new DOMException("aborted", "AbortError"));
    await expect(zotero.search({ query: "x" })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("treats any failure after the signal was aborted as a cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    stub(new Error("request cancelled")); // a transport that rejects with a plain Error on abort
    await expect(zotero.search({ query: "x" }, { signal: controller.signal })).rejects.toThrow("request cancelled");
  });
});

describe("source registry", () => {
  it("offers Zotero but leaves it off by default", () => {
    expect(getSource("zotero")).toBe(zotero);
    expect(DEFAULT_SOURCE_IDS).not.toContain("zotero");
    expect(DEFAULT_SOURCE_IDS).toHaveLength(SOURCES.length - 1);
  });
});
