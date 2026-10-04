import { describe, expect, it } from "vitest";
import {
  applyFilters,
  arxivIdFromDoi,
  fuseRankings,
  hasActiveFilters,
  mergePapers,
  normalizeArxivId,
  normalizeDoi,
  normalizeTitle,
  paperKeys,
  sortPapers,
} from "./merge";
import type { Paper } from "./types";

function paper(over: Partial<Paper> & { id: string; title: string }): Paper {
  return {
    source: "semantic-scholar",
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

const ATTENTION = "Attention Is All You Need";
const LONG_TITLE = "Denoising Diffusion Probabilistic Models for Image Generation";

describe("identifier normalisation", () => {
  it("normalises DOIs", () => {
    expect(normalizeDoi("https://doi.org/10.1109/CVPR.2022.01042")).toBe("10.1109/cvpr.2022.01042");
    expect(normalizeDoi("doi: 10.1000/ABC")).toBe("10.1000/abc");
    expect(normalizeDoi("http://dx.doi.org/10.1000/abc")).toBe("10.1000/abc");
    expect(normalizeDoi("not a doi")).toBeNull();
    expect(normalizeDoi(null)).toBeNull();
  });

  it("normalises arXiv ids, dropping version and wrappers", () => {
    expect(normalizeArxivId("2401.01234v3")).toBe("2401.01234");
    expect(normalizeArxivId("arXiv:2401.01234")).toBe("2401.01234");
    expect(normalizeArxivId("https://arxiv.org/abs/2401.01234v2")).toBe("2401.01234");
    expect(normalizeArxivId("http://arxiv.org/pdf/2401.01234v1.pdf")).toBe("2401.01234");
    expect(normalizeArxivId("hep-th/9901001v1")).toBe("hep-th/9901001");
    expect(normalizeArxivId("1706.03762")).toBe("1706.03762");
    expect(normalizeArxivId("garbage")).toBeNull();
  });

  it("extracts the arXiv id from arXiv's DataCite DOI", () => {
    expect(arxivIdFromDoi("10.48550/arXiv.1706.03762")).toBe("1706.03762");
    expect(arxivIdFromDoi("10.1109/other")).toBeNull();
  });

  it("normalises titles across punctuation, case and accents", () => {
    expect(normalizeTitle("State-of-the-Art: Café Résumé!")).toBe(normalizeTitle("state of the art cafe resume"));
  });
});

describe("paperKeys", () => {
  it("includes doi, arxiv and long-title keys", () => {
    const keys = paperKeys(paper({ id: "a", title: LONG_TITLE, doi: "10.1000/AbC1", arxivId: "2006.11239v2" }));
    expect(keys).toEqual([
      "doi:10.1000/abc1",
      "arxiv:2006.11239",
      `title:${normalizeTitle(LONG_TITLE)}`,
    ]);
  });

  it("derives the arXiv key from an arXiv DataCite DOI", () => {
    const keys = paperKeys(paper({ id: "a", title: "x", doi: "10.48550/arXiv.2006.11239" }));
    expect(keys).toContain("arxiv:2006.11239");
  });

  it("drops malformed identifiers instead of keying on garbage", () => {
    expect(paperKeys(paper({ id: "a", title: "x", doi: "10.1/short", arxivId: "nope" }))).toEqual([]);
  });

  it("requires a first author to key on a short title", () => {
    expect(paperKeys(paper({ id: "a", title: "A survey of x" }))).toEqual([]);
    expect(paperKeys(paper({ id: "a", title: "A survey of x", authors: ["Ada Lovelace"] }))).toEqual([
      "title:asurveyofx:lovelace",
    ]);
  });

  it("ignores very short titles", () => {
    expect(paperKeys(paper({ id: "a", title: "Hello", authors: ["A B"] }))).toEqual([]);
  });
});

describe("mergePapers", () => {
  const s2 = paper({
    id: "s2:1",
    title: ATTENTION,
    authors: ["Ashish Vaswani", "Noam Shazeer"],
    year: 2017,
    venue: "NeurIPS",
    abstract: "Short.",
    tldr: "A new architecture.",
    citationCount: 100000,
    pdfUrl: null,
    arxivId: "1706.03762",
  });
  const arxiv = paper({
    id: "arxiv:1706.03762",
    source: "arxiv",
    title: ATTENTION,
    authors: ["Ashish Vaswani"],
    year: 2017,
    venue: "arXiv",
    abstract: "A much longer abstract that describes the Transformer in detail.",
    pdfUrl: "https://arxiv.org/pdf/1706.03762",
    arxivId: "1706.03762",
  });

  it("keeps the primary id, fills gaps and records both sources", () => {
    const merged = mergePapers(s2, arxiv);
    expect(merged.id).toBe("s2:1");
    expect(merged.pdfUrl).toBe("https://arxiv.org/pdf/1706.03762");
    expect(merged.abstract).toBe(arxiv.abstract);
    expect(merged.tldr).toBe("A new architecture.");
    expect(merged.authors).toEqual(["Ashish Vaswani", "Noam Shazeer"]);
    expect(merged.sources).toEqual(["semantic-scholar", "arxiv"]);
  });

  it("prefers a real venue over a bare 'arXiv'", () => {
    expect(mergePapers(arxiv, s2).venue).toBe("NeurIPS");
    expect(mergePapers(s2, arxiv).venue).toBe("NeurIPS");
  });

  it("takes the larger citation count and tolerates nulls", () => {
    expect(mergePapers(paper({ id: "a", title: "x", citationCount: 5 }), paper({ id: "b", title: "x", citationCount: 9 })).citationCount).toBe(9);
    expect(mergePapers(paper({ id: "a", title: "x" }), paper({ id: "b", title: "x" })).citationCount).toBeNull();
  });
});

describe("fuseRankings", () => {
  it("merges the same paper found by arXiv id, DOI-borne arXiv id, and title", () => {
    const s2 = paper({ id: "s2:1", title: ATTENTION + " (Transformers)", arxivId: "1706.03762", authors: ["Ashish Vaswani"] });
    const oa = paper({ id: "oa:W1", source: "openalex", title: "Something else entirely different here", doi: "10.48550/arXiv.1706.03762" });
    const ax = paper({ id: "arxiv:1706.03762", source: "arxiv", title: ATTENTION + " (Transformers)", arxivId: "1706.03762v5" });
    const fused = fuseRankings([[s2], [oa], [ax]]);
    expect(fused).toHaveLength(1);
    expect(fused[0].sources).toEqual(["semantic-scholar", "openalex", "arxiv"]);
  });

  it("merges by DOI even when titles differ", () => {
    const a = paper({ id: "a", title: "Completely different wording of the title", doi: "10.1000/xyz" });
    const b = paper({ id: "b", source: "openalex", title: "Another phrasing altogether of this paper", doi: "https://doi.org/10.1000/XYZ" });
    expect(fuseRankings([[a], [b]])).toHaveLength(1);
  });

  it("does not merge unrelated papers", () => {
    const a = paper({ id: "a", title: "Graph neural networks for molecular property prediction" });
    const b = paper({ id: "b", title: "Protein structure prediction with deep learning models" });
    expect(fuseRankings([[a, b]])).toHaveLength(2);
  });

  it("does not merge different papers that share a short title but not an author", () => {
    const a = paper({ id: "a", title: "A survey of RAG", authors: ["Ann Lee"] });
    const b = paper({ id: "b", title: "A survey of RAG", authors: ["Bob Stone"] });
    expect(fuseRankings([[a], [b]])).toHaveLength(2);
  });

  it("ranks a paper found by two sources above one found first by only one", () => {
    const solo = paper({ id: "solo", title: "Only found by the first source in this test" });
    const shared1 = paper({ id: "shared1", title: "Shared paper that both sources return together", doi: "10.1000/shared" });
    const shared2 = paper({ id: "shared2", source: "openalex", title: "Shared paper that both sources return together", doi: "10.1000/shared" });
    const fused = fuseRankings([[solo, shared1], [shared2]]);
    expect(fused.map((p) => p.id)).toEqual(["shared1", "solo"]);
  });

  it("is stable: equal scores keep source order", () => {
    const a = paper({ id: "a", title: "First source top result for the query" });
    const b = paper({ id: "b", source: "openalex", title: "Second source top result for the query" });
    expect(fuseRankings([[a], [b]]).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("does not double count a source that repeats a paper", () => {
    const dup1 = paper({ id: "d1", title: "A paper that source one lists twice in its page", doi: "10.1000/dup" });
    const dup2 = paper({ id: "d2", title: "A paper that source one lists twice in its page", doi: "10.1000/dup" });
    const other = paper({ id: "o", source: "openalex", title: "Ranked first by the second source in this test" });
    // dup is first in list 1 (twice) so it would win if double counted; with
    // single counting both top results score 1/61 and list order breaks the tie.
    expect(fuseRankings([[dup1, dup2], [other]]).map((p) => p.id)).toEqual(["d1", "o"]);
    expect(fuseRankings([[dup1, dup2], [other]])).toHaveLength(2);
  });

  it("folds two groups bridged by a later paper", () => {
    const byDoi = paper({ id: "a", title: "Wording one of the bridging paper example", doi: "10.1000/bridge" });
    const byArxiv = paper({ id: "b", source: "arxiv", title: "A wholly different wording of the same work", arxivId: "2001.00001" });
    const bridge = paper({ id: "c", source: "openalex", title: "Yet another wording for the bridge example", doi: "10.1000/bridge", arxivId: "2001.00001" });
    const fused = fuseRankings([[byDoi], [byArxiv], [bridge]]);
    expect(fused).toHaveLength(1);
    // Primary (first-listed) source leads; the order of the rest is incidental.
    expect(fused[0].sources?.[0]).toBe("semantic-scholar");
    expect([...(fused[0].sources ?? [])].sort()).toEqual(["arxiv", "openalex", "semantic-scholar"]);
  });

  it("handles empty input", () => {
    expect(fuseRankings([])).toEqual([]);
    expect(fuseRankings([[], []])).toEqual([]);
  });
});

describe("filters", () => {
  const p = (id: string, over: Partial<Paper> = {}) => paper({ id, title: id, ...over });
  const list = [
    p("old", { year: 2010, citationCount: 500, pdfUrl: "x" }),
    p("new", { year: 2023, citationCount: 3 }),
    p("nocount", { year: 2020 }),
    p("noyear", { citationCount: 50 }),
  ];

  it("reports whether any filter is active", () => {
    expect(hasActiveFilters(undefined)).toBe(false);
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ minCitations: 0 })).toBe(false);
    expect(hasActiveFilters({ openAccessOnly: true })).toBe(true);
  });

  it("returns the same array when nothing is filtered", () => {
    expect(applyFilters(list, {})).toBe(list);
  });

  it("filters by year range, excluding unknown years", () => {
    expect(applyFilters(list, { yearFrom: 2015 }).map((x) => x.id)).toEqual(["new", "nocount"]);
    expect(applyFilters(list, { yearTo: 2015 }).map((x) => x.id)).toEqual(["old"]);
    expect(applyFilters(list, { yearFrom: 2010, yearTo: 2020 }).map((x) => x.id)).toEqual(["old", "nocount"]);
  });

  it("filters by citations, excluding unknown counts", () => {
    expect(applyFilters(list, { minCitations: 10 }).map((x) => x.id)).toEqual(["old", "noyear"]);
  });

  it("filters to open access", () => {
    expect(applyFilters(list, { openAccessOnly: true }).map((x) => x.id)).toEqual(["old"]);
  });

  it("combines filters", () => {
    expect(applyFilters(list, { yearFrom: 2000, minCitations: 100, openAccessOnly: true }).map((x) => x.id)).toEqual(["old"]);
  });
});

describe("sortPapers", () => {
  const p = (id: string, over: Partial<Paper> = {}) => paper({ id, title: id, ...over });
  const list = [
    p("a", { year: 2019, citationCount: 10 }),
    p("b", { year: 2023, citationCount: null }),
    p("c", { year: null, citationCount: 900 }),
    p("d", { year: 2023, citationCount: 10 }),
  ];

  it("keeps relevance order untouched", () => {
    expect(sortPapers(list, "relevance")).toBe(list);
  });

  it("sorts by citations, unknown last, stable on ties", () => {
    expect(sortPapers(list, "citations").map((x) => x.id)).toEqual(["c", "a", "d", "b"]);
  });

  it("sorts newest first, unknown last, stable on ties", () => {
    expect(sortPapers(list, "newest").map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("does not mutate its input", () => {
    const copy = [...list];
    sortPapers(list, "citations");
    expect(list).toEqual(copy);
  });
});
