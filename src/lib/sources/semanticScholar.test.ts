import { afterEach, describe, expect, it, vi } from "vitest";
import { mapS2Paper, semanticScholar, yearParam, type S2Paper } from "./semanticScholar";

const full: S2Paper = {
  paperId: "c10075b3",
  title: "High-Resolution Image Synthesis with Latent Diffusion Models",
  abstract: "By decomposing the image formation process…",
  year: 2021,
  venue: "Computer Vision and Pattern Recognition",
  citationCount: 25166,
  url: "https://www.semanticscholar.org/paper/c10075b3",
  authors: [{ name: "Robin Rombach" }, { name: "A. Blattmann" }],
  tldr: { text: "These latent diffusion models achieve new state of the art…" },
  externalIds: { ArXiv: "2112.10752", DOI: "10.1109/CVPR52688.2022.01042", CorpusId: 245335280 },
  openAccessPdf: { url: "https://arxiv.org/pdf/2112.10752" },
};

describe("mapS2Paper", () => {
  it("maps a fully-populated paper", () => {
    const paper = mapS2Paper(full);
    expect(paper).toEqual({
      id: "s2:c10075b3",
      source: "semantic-scholar",
      title: "High-Resolution Image Synthesis with Latent Diffusion Models",
      authors: ["Robin Rombach", "A. Blattmann"],
      year: 2021,
      venue: "Computer Vision and Pattern Recognition",
      abstract: "By decomposing the image formation process…",
      tldr: "These latent diffusion models achieve new state of the art…",
      citationCount: 25166,
      url: "https://www.semanticscholar.org/paper/c10075b3",
      pdfUrl: "https://arxiv.org/pdf/2112.10752",
      doi: "10.1109/CVPR52688.2022.01042",
      arxivId: "2112.10752",
    });
  });

  it("nulls every optional field on a sparse paper", () => {
    const paper = mapS2Paper({ paperId: "x", title: "Sparse" });
    expect(paper).toEqual({
      id: "s2:x",
      source: "semantic-scholar",
      title: "Sparse",
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
    });
  });

  it("treats empty venue as null and stringifies numeric ids", () => {
    const paper = mapS2Paper({
      paperId: "x",
      title: "T",
      venue: "",
      externalIds: { ArXiv: 2112.10752 },
    });
    expect(paper.venue).toBeNull();
    expect(paper.arxivId).toBe("2112.10752");
  });
});

describe("semanticScholar.search", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(body: unknown, status = 200, headers: Record<string, string> = {}) {
    const fn = vi.fn(async (..._args: unknown[]) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }),
    );
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  function lastUrl(fn: ReturnType<typeof stub>): URL {
    return new URL(String(fn.mock.calls.at(-1)?.[0]));
  }

  it("sends query, paging and filters", async () => {
    const fn = stub({ total: 1, offset: 20, data: [{ paperId: "p", title: "T" }] });
    const result = await semanticScholar.search({
      query: "graphs",
      limit: 20,
      offset: 20,
      filters: { yearFrom: 2020, yearTo: 2024, minCitations: 50, openAccessOnly: true },
    });
    const url = lastUrl(fn);
    expect(url.searchParams.get("query")).toBe("graphs");
    expect(url.searchParams.get("offset")).toBe("20");
    expect(url.searchParams.get("year")).toBe("2020-2024");
    expect(url.searchParams.get("minCitationCount")).toBe("50");
    expect(url.searchParams.has("openAccessPdf")).toBe(true);
    expect(result.papers[0].id).toBe("s2:p");
    expect(result.nextOffset).toBeNull();
  });

  it("omits filter params that are not set", async () => {
    const fn = stub({ total: 0, data: [] });
    await semanticScholar.search({ query: "x" });
    const url = lastUrl(fn);
    for (const key of ["year", "minCitationCount", "openAccessPdf"]) {
      expect(url.searchParams.has(key)).toBe(false);
    }
  });

  it("passes the api key and returns the next offset", async () => {
    const fn = stub({ total: 100, offset: 0, next: 20, data: [] });
    const result = await semanticScholar.search({ query: "x" }, { apiKey: "k" });
    const init = fn.mock.calls.at(-1)?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(result.nextOffset).toBe(20);
  });

  it("explains a rate limit once retries are exhausted", async () => {
    // Retry-After beyond the cap means we give up immediately rather than stall the UI.
    stub({}, 429, { "retry-after": "120" });
    await expect(semanticScholar.search({ query: "x" })).rejects.toThrow(/Rate limited/);
  });

  it("explains a rejected key", async () => {
    stub({}, 403);
    await expect(semanticScholar.search({ query: "x" })).rejects.toThrow(/rejected the API key/);
  });
});

describe("yearParam", () => {
  it.each([
    [{}, null],
    [{ yearFrom: 2019 }, "2019-"],
    [{ yearTo: 2022 }, "-2022"],
    [{ yearFrom: 2019, yearTo: 2022 }, "2019-2022"],
    [{ yearFrom: 2020, yearTo: 2020 }, "2020"],
  ])("%j → %s", (filters, expected) => {
    expect(yearParam(filters)).toBe(expected);
  });
});
