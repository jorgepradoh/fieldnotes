import { describe, it, expect } from "vitest";
import { toBibTeX, toMarkdown, toJSON, type ExportOptions } from "./exporters";
import type { LibraryEntry } from "../library/model";

const FULL_PAPER: LibraryEntry = {
  addedAt: Date.parse("2024-01-15T10:00:00.000Z"),
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
  addedAt: Date.parse("2024-01-15T11:00:00.000Z"),
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

const NOTE = "Key insight: multi-head attention rocks.";
const NOTED: LibraryEntry = { ...FULL_PAPER, note: NOTE };
const ORGANISED: LibraryEntry = { ...FULL_PAPER, note: NOTE, status: "reading", statusAt: 5, tags: ["transformers", "nlp"] };
const WITH: ExportOptions = { notes: true };
const WITHOUT: ExportOptions = { notes: false };

describe("toBibTeX", () => {
  it("generates @article for arXiv paper with authors+year", () => {
    const out = toBibTeX([FULL_PAPER], WITH);
    expect(out).toMatch(/@article\{arxiv_1706_03762,/);
    expect(out).toMatch(/title = \{Attention Is All You Need\}/);
    expect(out).toMatch(/author = \{Vaswani, Ashish and Shazeer, Noam and Parikh, Niki\}/);
    expect(out).toMatch(/year = \{2017\}/);
    expect(out).toMatch(/eprint = \{1706\.03762\}/);
    expect(out).toMatch(/archivePrefix = \{arXiv\}/);
  });

  it("includes annote when the paper has a note", () => {
    const out = toBibTeX([NOTED], WITH);
    expect(out).toMatch(/annote = \{Key insight: multi-head attention rocks\.\}/);
  });

  it("leaves the note out when notes are not included", () => {
    expect(toBibTeX([NOTED], WITHOUT)).not.toMatch(/annote/);
  });

  it("writes tags as keywords, with or without notes", () => {
    expect(toBibTeX([ORGANISED], WITH)).toMatch(/keywords = \{transformers, nlp\}/);
    expect(toBibTeX([ORGANISED], WITHOUT)).toMatch(/keywords = \{transformers, nlp\}/);
    expect(toBibTeX([FULL_PAPER], WITH)).not.toMatch(/keywords/);
  });

  it("cannot be broken out of its braces through a tag or a note", () => {
    const hostile: LibraryEntry = { ...FULL_PAPER, tags: ["a}, @evil{x", "back\\slash"], note: "close } and { open\n@article{injected," };
    const out = toBibTeX([hostile], WITH);
    expect(out).not.toMatch(/keywords = \{[^}]*\}[^\n]*\}/);
    expect(out.match(/@\w+\{/g)).toEqual(["@article{"]);
    expect(out).not.toMatch(/keywords = \{[^\n]*\}[^,\n]/);
  });

  it("generates @misc for local PDF with no authors or year", () => {
    const out = toBibTeX([LOCAL_PAPER], WITH);
    expect(out).toMatch(/@misc\{/);
    expect(out).not.toMatch(/author/);
    expect(out).not.toMatch(/year/);
  });

  it("exports multiple papers separated by blank line", () => {
    const out = toBibTeX([FULL_PAPER, LOCAL_PAPER], WITH);
    expect(out.split("\n\n").length).toBeGreaterThanOrEqual(2);
  });
});

describe("toMarkdown", () => {
  it("includes paper title as heading", () => {
    const out = toMarkdown([FULL_PAPER], WITH);
    expect(out).toContain("## Attention Is All You Need");
  });

  it("includes authors, year, venue, arXiv ID", () => {
    const out = toMarkdown([FULL_PAPER], WITH);
    expect(out).toContain("Vaswani, Ashish");
    expect(out).toContain("2017");
    expect(out).toContain("cs.LG");
    expect(out).toContain("1706.03762");
  });

  it("includes the note under ### Notes", () => {
    const out = toMarkdown([NOTED], WITH);
    expect(out).toContain("### Notes");
    expect(out).toContain("Key insight: multi-head attention rocks.");
  });

  it("leaves the notes section out when notes are not included", () => {
    const out = toMarkdown([NOTED], WITHOUT);
    expect(out).not.toContain("### Notes");
    expect(out).not.toContain("Key insight");
  });

  it("lists status and tags, with or without notes", () => {
    for (const opts of [WITH, WITHOUT]) {
      const out = toMarkdown([ORGANISED], opts);
      expect(out).toContain("**Status:** Reading");
      expect(out).toContain("**Tags:** transformers, nlp");
    }
    const plain = toMarkdown([FULL_PAPER], WITH);
    expect(plain).not.toContain("**Status:**");
    expect(plain).not.toContain("**Tags:**");
  });

  it("omits abstract section when abstract is null", () => {
    const out = toMarkdown([LOCAL_PAPER], WITH);
    expect(out).not.toContain("### Abstract");
  });

  it("starts with a header line containing the paper count", () => {
    const out = toMarkdown([FULL_PAPER], WITH);
    expect(out).toMatch(/# Research Library Export/);
    expect(out).toContain("1 paper");
  });
});

describe("toJSON", () => {
  it("returns valid JSON with paper + savedAt + annotation", () => {
    const out = toJSON([NOTED], WITH);
    const parsed = JSON.parse(out) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    const item = parsed[0] as Record<string, unknown>;
    expect(item.savedAt).toBe("2024-01-15T10:00:00.000Z");
    expect(item.annotation).toBe("Key insight: multi-head attention rocks.");
  });

  it("uses empty string for a missing note and null for no status", () => {
    const out = toJSON([FULL_PAPER], WITH);
    const parsed = JSON.parse(out) as Array<{ annotation: string; note: string; status: string | null; tags: string[] }>;
    expect(parsed[0]).toMatchObject({ annotation: "", note: "", status: null, tags: [] });
  });

  it("carries status, tags and the note, and keeps annotation equal to note", () => {
    const [item] = JSON.parse(toJSON([ORGANISED], WITH)) as Array<Record<string, unknown>>;
    expect(item).toMatchObject({ status: "reading", tags: ["transformers", "nlp"], note: NOTE, annotation: NOTE, savedAt: "2024-01-15T10:00:00.000Z" });
  });

  it("empties the note and annotation when notes are not included, but keeps status and tags", () => {
    const [item] = JSON.parse(toJSON([ORGANISED], WITHOUT)) as Array<Record<string, unknown>>;
    expect(item).toMatchObject({ status: "reading", tags: ["transformers", "nlp"], note: "", annotation: "" });
    expect(JSON.stringify(item)).not.toContain("Key insight");
  });
});
