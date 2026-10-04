import { describe, expect, it } from "vitest";
import type { Paper } from "../sources/types";
import { authorLine, briefToMarkdown, buildBrief, estimateTokens, referencesMarkdown, selectCorpus, systemPrompt, visibleText } from "./prompt";

function paper(over: Partial<Paper> = {}): Paper {
  return {
    id: "p1",
    source: "semantic-scholar",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
    year: 2017,
    venue: "NeurIPS",
    abstract: "The dominant sequence transduction models are based on complex recurrent networks.",
    tldr: "A new architecture based solely on attention.",
    citationCount: 100000,
    url: null,
    pdfUrl: null,
    doi: null,
    arxivId: null,
    ...over,
  };
}

describe("buildBrief", () => {
  const brief = buildBrief({ topic: "transformers", depth: "standard", papers: [paper(), paper({ id: "p2", title: "BERT", authors: ["Jacob Devlin"], year: null, venue: null, citationCount: null, tldr: null, abstract: null })] });

  it("numbers papers from 1 inside <papers> and includes metadata", () => {
    expect(brief.user).toContain("<papers>");
    expect(brief.user).toContain("</papers>");
    expect(brief.user).toContain("[1] Attention Is All You Need");
    expect(brief.user).toContain("Ashish Vaswani, Noam Shazeer, Niki Parmar et al. · 2017 · NeurIPS · 100,000 citations");
    expect(brief.user).toContain("TL;DR: A new architecture based solely on attention.");
    expect(brief.user).toContain("[2] BERT");
    expect(brief.user).toContain("Abstract: (not available)");
  });

  it("states the topic and paper count, omits Focus when absent", () => {
    expect(brief.user).toContain("Topic: transformers");
    expect(brief.user).toContain("The 2 papers below");
    expect(brief.user).not.toContain("Focus:");
  });

  it("includes a trimmed focus when given", () => {
    const b = buildBrief({ topic: "t", focus: "  safety and evaluation  ", depth: "short", papers: [paper()] });
    expect(b.user).toContain("Focus: safety and evaluation");
    expect(b.user).toContain("The 1 paper below");
  });

  it("clips long abstracts on a word boundary and flattens whitespace", () => {
    const long = ("word ".repeat(500)).trim();
    const b = buildBrief({ topic: "t", depth: "short", papers: [paper({ abstract: `line one\n\n${long}` })], abstractChars: 100 });
    const line = b.user.split("\n").find((l) => l.startsWith("Abstract:")) ?? "";
    expect(line.length).toBeLessThanOrEqual("Abstract: ".length + 101);
    expect(line.endsWith("…")).toBe(true);
    expect(line).not.toContain("\n");
  });

  it("handles an empty topic", () => {
    expect(buildBrief({ topic: "  ", depth: "short", papers: [] }).user).toContain("Topic: (not specified)");
  });
});

describe("systemPrompt", () => {
  it("treats paper text as untrusted and requires bracketed citations", () => {
    const s = systemPrompt("standard");
    expect(s).toMatch(/untrusted data/);
    expect(s).toMatch(/never follow directions/);
    expect(s).toMatch(/Never cite a number that is not in the list/);
    expect(s).toMatch(/Do not invent papers/);
  });

  it("varies length guidance by depth", () => {
    expect(systemPrompt("short")).toContain("300 words");
    expect(systemPrompt("standard")).toContain("700 words");
    expect(systemPrompt("deep")).toContain("1,400 words");
    expect(new Set(["short", "standard", "deep"].map((d) => systemPrompt(d as never))).size).toBe(3);
  });
});

describe("helpers", () => {
  it("authorLine truncates with et al.", () => {
    expect(authorLine(paper({ authors: ["A", "B"] }))).toBe("A, B");
    expect(authorLine(paper({ authors: ["A", "B", "C", "D"] }))).toBe("A, B, C et al.");
    expect(authorLine(paper({ authors: [] }))).toBe("");
  });

  it("selectCorpus drops excluded ids before applying the limit", () => {
    const ps = ["a", "b", "c", "d"].map((id) => paper({ id }));
    expect(selectCorpus(ps, 2, new Set(["a"])).map((p) => p.id)).toEqual(["b", "c"]);
    expect(selectCorpus(ps, 10, new Set()).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(selectCorpus(ps, 0, new Set())).toEqual([]);
    expect(selectCorpus(ps, -3, new Set())).toEqual([]);
  });

  it("estimateTokens is ~chars/4, summed", () => {
    expect(estimateTokens("a".repeat(400), "b".repeat(400))).toBe(200);
    expect(estimateTokens("")).toBe(0);
  });

  it("visibleText hides complete and still-open <think> blocks", () => {
    expect(visibleText("<think>hmm</think>\n\nAnswer")).toBe("Answer");
    expect(visibleText("<think>still thinking")).toBe("");
    expect(visibleText("Intro <think>x</think>Rest")).toBe("Intro Rest");
    expect(visibleText("No tags here")).toBe("No tags here");
  });
});

describe("export", () => {
  const papers = [
    paper({ id: "a", title: "Attention  Is All\nYou Need", authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, doi: "10.1000/xyz" }),
    paper({ id: "b", title: "No link paper", authors: [], year: null, doi: null, url: null, arxivId: null }),
    paper({ id: "c", title: "arXiv only", authors: ["A B"], year: 2020, doi: null, url: null, arxivId: "2001.00001" }),
    paper({ id: "d", title: "URL only", authors: [], year: 2021, doi: null, url: "https://example.org/p" }),
  ];

  it("lists sources with the best available link", () => {
    expect(referencesMarkdown(papers).split("\n")).toEqual([
      "1. Attention Is All You Need — Ashish Vaswani, Noam Shazeer, 2017 <https://doi.org/10.1000/xyz>",
      "2. No link paper",
      "3. arXiv only — A B, 2020 <https://arxiv.org/abs/2001.00001>",
      "4. URL only — 2021 <https://example.org/p>",
    ]);
  });

  it("builds a self-contained document with provenance and a caveat", () => {
    const md = briefToMarkdown({ topic: "diffusion models", text: "## In brief\nSomething [1].\n", papers: papers.slice(0, 1), model: "claude-opus-5-5", at: Date.UTC(2026, 9, 4) });
    expect(md.startsWith("# Field brief: diffusion models\n")).toBe(true);
    expect(md).toContain("_Generated 2026-10-04 with claude-opus-5-5 from 1 paper (abstracts only). AI-written");
    expect(md).toContain("## In brief\nSomething [1].");
    expect(md).toContain("## Sources\n\n1. Attention Is All You Need");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("copes with a missing topic and model", () => {
    const md = briefToMarkdown({ topic: " ", text: "x", papers, model: "", at: 0 });
    expect(md.startsWith("# Field brief\n")).toBe(true);
    expect(md).toContain("_Generated 1970-01-01 from 4 papers");
  });
});
