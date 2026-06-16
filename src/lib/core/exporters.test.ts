import { describe, it, expect } from "vitest";
import { toBibTeX, toMarkdown, toJSON } from "./exporters";
import type { LibraryEntry } from "./library.svelte";

const FULL_PAPER: LibraryEntry = {
  savedAt: "2024-01-15T10:00:00.000Z",
  paper: {
    id: "arxiv:1706.03762",
    source: "arxiv",
    title: "Attention Is All You Need",
    authors: ["Vaswani, Ashish", "Shazeer, Noam", "Parikh, Niki"],
    year: 2017,
    venue: "cs.LG",
    abstract: "The dominant sequence transduction models...",
    tldr: null,
    citationCount: null,
    url: "https://arxiv.org/abs/1706.03762",
    pdfUrl: "https://arxiv.org/pdf/1706.03762",
    doi: null,
    arxivId: "1706.03762",
  },
};

const LOCAL_PAPER: LibraryEntry = {
  savedAt: "2024-01-15T11:00:00.000Z",
  paper: {
    id: "local:/Users/me/papers/some_paper.pdf",
    source: "local",
    title: "some_paper",
    authors: [],
    year: null,
    venue: null,
    abstract: null,
    tldr: null,
    citationCount: null,
    url: null,
    pdfUrl: "local:///Users/me/papers/some_paper.pdf",
    doi: null,
    arxivId: null,
  },
};

const ANNOTATIONS = { "arxiv:1706.03762": "Key insight: multi-head attention rocks." };

describe("toBibTeX", () => {
  it("generates @article for arXiv paper with authors+year", () => {
    const out = toBibTeX([FULL_PAPER], {});
    expect(out).toMatch(/@article\{arxiv_1706_03762,/);
    expect(out).toMatch(/title = \{Attention Is All You Need\}/);
    expect(out).toMatch(/author = \{Vaswani, Ashish and Shazeer, Noam and Parikh, Niki\}/);
    expect(out).toMatch(/year = \{2017\}/);
    expect(out).toMatch(/eprint = \{1706\.03762\}/);
    expect(out).toMatch(/archivePrefix = \{arXiv\}/);
  });

  it("includes annote when annotation present", () => {
    const out = toBibTeX([FULL_PAPER], ANNOTATIONS);
    expect(out).toMatch(/annote = \{Key insight: multi-head attention rocks\.\}/);
  });

  it("generates @misc for local PDF with no authors or year", () => {
    const out = toBibTeX([LOCAL_PAPER], {});
    expect(out).toMatch(/@misc\{/);
    expect(out).not.toMatch(/author/);
    expect(out).not.toMatch(/year/);
  });

  it("exports multiple papers separated by blank line", () => {
    const out = toBibTeX([FULL_PAPER, LOCAL_PAPER], {});
    expect(out.split("\n\n").length).toBeGreaterThanOrEqual(2);
  });
});

describe("toMarkdown", () => {
  it("includes paper title as heading", () => {
    const out = toMarkdown([FULL_PAPER], {});
    expect(out).toContain("## Attention Is All You Need");
  });

  it("includes authors, year, venue, arXiv ID", () => {
    const out = toMarkdown([FULL_PAPER], {});
    expect(out).toContain("Vaswani, Ashish");
    expect(out).toContain("2017");
    expect(out).toContain("cs.LG");
    expect(out).toContain("1706.03762");
  });

  it("includes annotation under ### Notes", () => {
    const out = toMarkdown([FULL_PAPER], ANNOTATIONS);
    expect(out).toContain("### Notes");
    expect(out).toContain("Key insight: multi-head attention rocks.");
  });

  it("omits abstract section when abstract is null", () => {
    const out = toMarkdown([LOCAL_PAPER], {});
    expect(out).not.toContain("### Abstract");
  });

  it("starts with a header line containing the paper count", () => {
    const out = toMarkdown([FULL_PAPER], {});
    expect(out).toMatch(/# Research Library Export/);
    expect(out).toContain("1 paper");
  });
});

describe("toJSON", () => {
  it("returns valid JSON with paper + savedAt + annotation", () => {
    const out = toJSON([FULL_PAPER], ANNOTATIONS);
    const parsed = JSON.parse(out) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    const item = parsed[0] as Record<string, unknown>;
    expect(item.savedAt).toBe("2024-01-15T10:00:00.000Z");
    expect(item.annotation).toBe("Key insight: multi-head attention rocks.");
  });

  it("uses empty string for missing annotation", () => {
    const out = toJSON([FULL_PAPER], {});
    const parsed = JSON.parse(out) as Array<{ annotation: string }>;
    expect(parsed[0].annotation).toBe("");
  });
});
