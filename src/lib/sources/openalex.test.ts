import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abstractFromInvertedIndex,
  buildFilter,
  mapOpenAlexWork,
  openAlex,
  type OpenAlexWork,
} from "./openalex";

const work: OpenAlexWork = {
  id: "https://openalex.org/W2741809807",
  doi: "https://doi.org/10.1109/CVPR.2022.01042",
  title: "High-Resolution Image Synthesis with Latent Diffusion Models",
  display_name: "ignored when title is present",
  publication_year: 2022,
  primary_location: {
    landing_page_url: "https://doi.org/10.1109/CVPR.2022.01042",
    source: { display_name: "2022 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)" },
  },
  best_oa_location: {
    landing_page_url: "https://arxiv.org/abs/2112.10752",
    pdf_url: "https://arxiv.org/pdf/2112.10752",
  },
  authorships: [
    { author: { display_name: "Robin Rombach" } },
    { author: { display_name: null } },
    { author: { display_name: "Björn Ommer" } },
  ],
  abstract_inverted_index: { By: [0], decomposing: [1], the: [2, 5], image: [3], formation: [4], process: [6] },
  cited_by_count: 25166,
  open_access: { is_oa: true, oa_url: "https://arxiv.org/pdf/2112.10752" },
};

describe("abstractFromInvertedIndex", () => {
  it("rebuilds running text from word positions", () => {
    expect(abstractFromInvertedIndex(work.abstract_inverted_index)).toBe(
      "By decomposing the image formation the process",
    );
  });

  it("handles gaps, empties and nulls", () => {
    expect(abstractFromInvertedIndex({ a: [0], c: [2] })).toBe("a c");
    expect(abstractFromInvertedIndex({})).toBeNull();
    expect(abstractFromInvertedIndex(null)).toBeNull();
  });
});

describe("mapOpenAlexWork", () => {
  it("maps a full work", () => {
    expect(mapOpenAlexWork(work)).toEqual({
      id: "oa:W2741809807",
      source: "openalex",
      title: "High-Resolution Image Synthesis with Latent Diffusion Models",
      authors: ["Robin Rombach", "Björn Ommer"],
      year: 2022,
      venue: "2022 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)",
      abstract: "By decomposing the image formation the process",
      tldr: null,
      citationCount: 25166,
      url: "https://doi.org/10.1109/CVPR.2022.01042",
      pdfUrl: "https://arxiv.org/pdf/2112.10752",
      doi: "10.1109/cvpr.2022.01042",
      arxivId: "2112.10752",
    });
  });

  it("falls back sensibly on a sparse work", () => {
    const paper = mapOpenAlexWork({ id: "https://openalex.org/W1", display_name: "Only a display name" });
    expect(paper).toMatchObject({
      id: "oa:W1",
      title: "Only a display name",
      authors: [],
      year: null,
      venue: null,
      abstract: null,
      citationCount: null,
      url: "https://openalex.org/W1",
      pdfUrl: null,
      doi: null,
      arxivId: null,
    });
  });

  it("finds the arXiv id from arXiv's DataCite DOI", () => {
    const paper = mapOpenAlexWork({ id: "https://openalex.org/W2", doi: "https://doi.org/10.48550/arxiv.1706.03762", title: "t" });
    expect(paper.arxivId).toBe("1706.03762");
    expect(paper.url).toBe("https://doi.org/10.48550/arxiv.1706.03762");
  });

  it("only treats oa_url as a PDF when it looks like one", () => {
    const html = mapOpenAlexWork({ id: "https://openalex.org/W3", title: "t", open_access: { oa_url: "https://example.org/landing" } });
    const pdf = mapOpenAlexWork({ id: "https://openalex.org/W4", title: "t", open_access: { oa_url: "https://example.org/paper.pdf?dl=1" } });
    expect(html.pdfUrl).toBeNull();
    expect(pdf.pdfUrl).toBe("https://example.org/paper.pdf?dl=1");
  });
});

describe("buildFilter", () => {
  it("is empty without filters", () => {
    expect(buildFilter(undefined)).toBe("");
    expect(buildFilter({})).toBe("");
  });

  it("builds a comma-joined filter", () => {
    expect(buildFilter({ yearFrom: 2020, yearTo: 2024, minCitations: 50, openAccessOnly: true })).toBe(
      "from_publication_date:2020-01-01,to_publication_date:2024-12-31,cited_by_count:>49,open_access.is_oa:true",
    );
  });
});

describe("openAlex.search", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(body: unknown, status = 200) {
    const fn = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  const lastUrl = (fn: ReturnType<typeof stub>) => new URL(String(fn.mock.calls.at(-1)?.[0]));

  it("requests the right page, fields, filters, sort and credentials", async () => {
    const fn = stub({ meta: { count: 500 }, results: [work] });
    await openAlex.search(
      { query: "diffusion", limit: 20, offset: 40, sort: "citations", filters: { yearFrom: 2021 } },
      { email: "me@example.org", apiKey: "k" },
    );
    const url = lastUrl(fn);
    expect(url.searchParams.get("search")).toBe("diffusion");
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("per-page")).toBe("20");
    expect(url.searchParams.get("filter")).toBe("from_publication_date:2021-01-01");
    expect(url.searchParams.get("sort")).toBe("cited_by_count:desc");
    expect(url.searchParams.get("mailto")).toBe("me@example.org");
    expect(url.searchParams.get("api_key")).toBe("k");
    expect(url.searchParams.get("select")).toContain("abstract_inverted_index");
  });

  it("omits optional params and maps newest to publication_date", async () => {
    const fn = stub({ meta: { count: 1 }, results: [work] });
    await openAlex.search({ query: "x", sort: "newest" });
    const url = lastUrl(fn);
    expect(url.searchParams.get("sort")).toBe("publication_date:desc");
    for (const key of ["filter", "mailto", "api_key"]) expect(url.searchParams.has(key)).toBe(false);
  });

  it("computes the next offset and stops at the end", async () => {
    stub({ meta: { count: 45 }, results: Array.from({ length: 20 }, (_, i) => ({ ...work, id: `https://openalex.org/W${i}` })) });
    const first = await openAlex.search({ query: "x", limit: 20, offset: 0 });
    expect(first.nextOffset).toBe(20);
    expect(first.total).toBe(45);

    stub({ meta: { count: 45 }, results: [work, work, work, work, work] });
    expect((await openAlex.search({ query: "x", limit: 20, offset: 40 })).nextOffset).toBeNull();
  });

  it("stops paging at OpenAlex's 10,000 result window", async () => {
    stub({ meta: { count: 50_000 }, results: Array.from({ length: 20 }, () => work) });
    expect((await openAlex.search({ query: "x", limit: 20, offset: 9_980 })).nextOffset).toBeNull();
  });

  it("maps HTTP failures to useful messages", async () => {
    stub({}, 403);
    await expect(openAlex.search({ query: "x" })).rejects.toThrow(/rejected the request/);
    stub({}, 500);
    await expect(openAlex.search({ query: "x" })).rejects.toThrow(/failed \(500\)/);
  });
});
