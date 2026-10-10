import { describe, expect, it } from "vitest";
import type { Paper } from "../sources/types";
import type { LibraryEntry } from "./model";
import { matchesEntry, matchesQuery, sortRows } from "./query";

function paper(over: Partial<Paper> & { id: string }): Paper {
  return {
    source: "bibtex",
    title: `Title ${over.id}`,
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
const entry = (over: Partial<LibraryEntry> & { paper: Paper }): LibraryEntry => ({ addedAt: 1, ...over });
const ANY = { query: "", status: "all", tag: null } as const;

describe("matchesQuery", () => {
  const p = paper({ id: "a", title: "Attention Is All You Need", authors: ["Ashish Vaswani"], year: 2017 });

  it("needs every term, in any order, ignoring case and accents", () => {
    expect(matchesQuery(p, "attention vaswani")).toBe(true);
    expect(matchesQuery(p, "VASWANI 2017")).toBe(true);
    expect(matchesQuery(p, "attention bert")).toBe(false);
    expect(matchesQuery(paper({ id: "b", title: "Café society" }), "cafe")).toBe(true);
  });

  it("matches everything for an empty query", () => {
    expect(matchesQuery(p, "")).toBe(true);
    expect(matchesQuery(p, "   ")).toBe(true);
  });

  it("also looks in the tags it is given", () => {
    expect(matchesQuery(p, "transformers")).toBe(false);
    expect(matchesQuery(p, "transformers", ["transformers"])).toBe(true);
    expect(matchesQuery(p, "attention transformers", ["transformers"])).toBe(true);
  });
});

describe("matchesEntry", () => {
  const queued = entry({ paper: paper({ id: "q", title: "Queued paper" }), status: "reading", statusAt: 1, tags: ["nlp", "survey"] });
  const plain = entry({ paper: paper({ id: "p", title: "Plain paper" }) });

  it("shows everything with no filter", () => {
    expect(matchesEntry(queued, ANY)).toBe(true);
    expect(matchesEntry(plain, ANY)).toBe(true);
  });

  it("filters by one status, and 'none' means not queued", () => {
    expect(matchesEntry(queued, { ...ANY, status: "reading" })).toBe(true);
    expect(matchesEntry(queued, { ...ANY, status: "done" })).toBe(false);
    expect(matchesEntry(plain, { ...ANY, status: "reading" })).toBe(false);
    expect(matchesEntry(plain, { ...ANY, status: "none" })).toBe(true);
    expect(matchesEntry(queued, { ...ANY, status: "none" })).toBe(false);
  });

  it("filters by tag", () => {
    expect(matchesEntry(queued, { ...ANY, tag: "nlp" })).toBe(true);
    expect(matchesEntry(queued, { ...ANY, tag: "vision" })).toBe(false);
    expect(matchesEntry(plain, { ...ANY, tag: "nlp" })).toBe(false);
  });

  it("combines status, tag and text, all of which must hold", () => {
    const f = { query: "queued", status: "reading", tag: "survey" } as const;
    expect(matchesEntry(queued, f)).toBe(true);
    expect(matchesEntry(queued, { ...f, query: "plain" })).toBe(false);
    expect(matchesEntry(queued, { ...f, status: "done" })).toBe(false);
    expect(matchesEntry(queued, { ...f, tag: "nlp2" })).toBe(false);
  });

  it("finds a paper by one of its tags in the text box", () => {
    expect(matchesEntry(queued, { ...ANY, query: "survey" })).toBe(true);
    expect(matchesEntry(plain, { ...ANY, query: "survey" })).toBe(false);
  });
});

describe("sortRows", () => {
  const rows = [
    entry({ paper: paper({ id: "b", title: "Beta", year: 2020, citationCount: 5 }), addedAt: 10 }),
    entry({ paper: paper({ id: "a", title: "Alpha", year: 2022, citationCount: 50 }), addedAt: 30 }),
    entry({ paper: paper({ id: "c", title: "Gamma", year: null, citationCount: null }), addedAt: 20 }),
  ];
  const ids = (sort: Parameters<typeof sortRows>[1]) => sortRows(rows, sort).map((r) => r.paper.id);

  it("orders by each key", () => {
    expect(ids("added")).toEqual(["a", "c", "b"]);
    expect(ids("title")).toEqual(["a", "b", "c"]);
    expect(ids("year")).toEqual(["a", "b", "c"]);
    expect(ids("citations")).toEqual(["a", "b", "c"]);
  });

  it("does not reorder its input", () => {
    sortRows(rows, "title");
    expect(rows.map((r) => r.paper.id)).toEqual(["b", "a", "c"]);
  });
});
