import { describe, expect, it, vi } from "vitest";
import { allFailed, failures, fetchNextPage, hasMore, visiblePapers, type Batches } from "./federated";
import type { Paper, PaperSource, SearchParams, SearchResult } from "./types";

function paper(id: string, over: Partial<Paper> = {}): Paper {
  return {
    id,
    source: "x",
    title: `Distinct title number ${id} for testing purposes`,
    authors: [],
    year: null,
    venue: null,
    abstract: null,
    tldr: null,
    citationCount: null,
    url: null,
    pdfUrl: null,
    doi: null,
    arxivId: null,
    ...over,
  };
}

/** A source serving `pages`; page i is returned for offset i * pageSize. */
function fakeSource(id: string, pages: Paper[][], pageSize = 2): PaperSource & { search: ReturnType<typeof vi.fn> } {
  const total = pages.reduce((n, p) => n + p.length, 0);
  const search = vi.fn(async (params: SearchParams): Promise<SearchResult> => {
    const index = (params.offset ?? 0) / pageSize;
    const papers = pages[index] ?? [];
    const consumed = (params.offset ?? 0) + papers.length;
    return { papers, total, offset: params.offset ?? 0, nextOffset: consumed < total ? consumed : null };
  });
  return { id, name: id, shortName: id, search };
}

function failingSource(id: string, message: string) {
  return { id, name: id, shortName: id, search: vi.fn(async () => { throw new Error(message); }) } as PaperSource & { search: ReturnType<typeof vi.fn> };
}

const req = { query: "q", limit: 2 };

describe("fetchNextPage", () => {
  it("fetches the first page from every source in parallel", async () => {
    const a = fakeSource("a", [[paper("a1"), paper("a2")], [paper("a3")]]);
    const b = fakeSource("b", [[paper("b1")]]);
    const batches = await fetchNextPage([{ source: a, opts: {} }, { source: b, opts: {} }], req, null);
    expect(batches.a.papers.map((p) => p.id)).toEqual(["a1", "a2"]);
    expect(batches.a.next).toBe(2);
    expect(batches.b.next).toBeNull();
    expect(hasMore(batches)).toBe(true);
  });

  it("continues only the sources that have more, appending to what is there", async () => {
    const a = fakeSource("a", [[paper("a1"), paper("a2")], [paper("a3")]]);
    const b = fakeSource("b", [[paper("b1")]]);
    const configs = [{ source: a, opts: {} }, { source: b, opts: {} }];
    const first = await fetchNextPage(configs, req, null);
    b.search.mockClear();
    const second = await fetchNextPage(configs, req, first);
    expect(b.search).not.toHaveBeenCalled();
    expect(second.a.papers.map((p) => p.id)).toEqual(["a1", "a2", "a3"]);
    expect(second.a.next).toBeNull();
    expect(hasMore(second)).toBe(false);
  });

  it("isolates a failing source and keeps the others' results", async () => {
    const good = fakeSource("good", [[paper("g1")]]);
    const bad = failingSource("bad", "boom");
    const batches = await fetchNextPage([{ source: good, opts: {} }, { source: bad, opts: {} }], req, null);
    expect(batches.good.papers).toHaveLength(1);
    expect(batches.bad).toMatchObject({ papers: [], error: "boom", next: 0 });
    expect(failures(batches)).toEqual([{ id: "bad", message: "boom" }]);
    expect(allFailed(batches)).toBe(false);
    expect(hasMore(batches)).toBe(true);
  });

  it("retries a failed source from the same offset and keeps what it had", async () => {
    let calls = 0;
    const flaky: PaperSource = {
      id: "flaky", name: "flaky", shortName: "flaky",
      search: vi.fn(async (params: SearchParams): Promise<SearchResult> => {
        calls++;
        if (calls === 2) throw new Error("hiccup");
        const offset = params.offset ?? 0;
        return { papers: [paper(`f${offset}`)], total: 10, offset, nextOffset: offset + 1 };
      }),
    };
    const configs = [{ source: flaky, opts: {} }];
    const first = await fetchNextPage(configs, req, null);
    const failed = await fetchNextPage(configs, req, first);
    expect(failed.flaky).toMatchObject({ error: "hiccup", next: 1 });
    expect(failed.flaky.papers.map((p) => p.id)).toEqual(["f0"]);
    const recovered = await fetchNextPage(configs, req, failed);
    expect(recovered.flaky.error).toBeNull();
    expect(recovered.flaky.papers.map((p) => p.id)).toEqual(["f0", "f1"]);
  });

  it("re-fetches a source that failed on page one, even though it never advanced", async () => {
    const bad = failingSource("bad", "down");
    const first = await fetchNextPage([{ source: bad, opts: {} }], req, null);
    expect(allFailed(first)).toBe(true);
    bad.search.mockClear();
    await fetchNextPage([{ source: bad, opts: {} }], req, first);
    expect(bad.search).toHaveBeenCalledTimes(1);
    expect(bad.search.mock.calls[0][0].offset).toBe(0);
  });

  it("passes query, filters, sort, signal and per-source options through", async () => {
    const a = fakeSource("a", [[paper("a1")]]);
    const controller = new AbortController();
    await fetchNextPage(
      [{ source: a, opts: { apiKey: "k", email: "e@x.io" } }],
      { query: "graphs", limit: 7, filters: { yearFrom: 2020 }, sort: "newest", signal: controller.signal },
      null,
    );
    const [params, opts] = a.search.mock.calls[0];
    expect(params).toMatchObject({ query: "graphs", limit: 7, offset: 0, filters: { yearFrom: 2020 }, sort: "newest" });
    expect(opts).toMatchObject({ apiKey: "k", email: "e@x.io", signal: controller.signal });
  });

  it("propagates an abort instead of reporting it as a source failure", async () => {
    const aborting: PaperSource = {
      id: "a", name: "a", shortName: "a",
      search: async () => { throw new DOMException("Aborted", "AbortError"); },
    };
    await expect(fetchNextPage([{ source: aborting, opts: {} }], req, null)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("starts over when prev is null even if sources were exhausted before", async () => {
    const a = fakeSource("a", [[paper("a1")]]);
    const configs = [{ source: a, opts: {} }];
    const first = await fetchNextPage(configs, req, null);
    const again = await fetchNextPage(configs, req, null);
    expect(again.a.papers).toEqual(first.a.papers);
    expect(a.search).toHaveBeenCalledTimes(2);
  });
});

describe("visiblePapers", () => {
  const batches: Batches = {
    s2: { papers: [paper("s2-1", { year: 2019, citationCount: 10, doi: "10.1000/same" }), paper("s2-2", { year: 2023, citationCount: 500 })], total: 2, next: null, error: null },
    arxiv: { papers: [paper("ax-1", { source: "arxiv", doi: "10.1000/same", pdfUrl: "https://arxiv.org/pdf/x", year: 2019 }), paper("ax-2", { source: "arxiv", year: 2024 })], total: 2, next: null, error: null },
  };

  it("fuses duplicates across sources and keeps source preference order for ties", () => {
    const list = visiblePapers(batches, ["s2", "arxiv"], undefined, "relevance");
    expect(list).toHaveLength(3);
    expect(list[0].id).toBe("s2-1");
    expect(list[0].pdfUrl).toBe("https://arxiv.org/pdf/x");
    expect(list[0].sources).toEqual(["x", "arxiv"]);
  });

  it("ignores sources that are not enabled", () => {
    const list = visiblePapers(batches, ["s2"], undefined, "relevance");
    expect(list.map((p) => p.id)).toEqual(["s2-1", "s2-2"]);
  });

  it("filters and sorts the fused list", () => {
    const filtered = visiblePapers(batches, ["s2", "arxiv"], { minCitations: 100 }, "relevance");
    expect(filtered.map((p) => p.id)).toEqual(["s2-2"]);
    const sorted = visiblePapers(batches, ["s2", "arxiv"], undefined, "newest");
    expect(sorted.map((p) => p.year)).toEqual([2024, 2023, 2019]);
  });

  it("tolerates a source with no batch yet", () => {
    expect(visiblePapers({}, ["s2"], undefined, "relevance")).toEqual([]);
  });
});
