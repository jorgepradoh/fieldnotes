import { describe, expect, it } from "vitest";
import { classifyFile, fallbackHash, fileId, looksLikePdf, parseMarkdownMeta, plausiblePdfTitle, stripFrontMatter, titleFromFileName } from "./files";
import { matchesQuery, sortRows, type Row } from "./query";
import type { Paper } from "../sources/types";

describe("classifyFile", () => {
  it.each([
    ["paper.pdf", "pdf"],
    ["PAPER.PDF", "pdf"],
    ["notes.md", "markdown"],
    ["notes.markdown", "markdown"],
    ["readme.txt", "markdown"],
    ["refs.bib", "bibtex"],
    ["refs.BIBTEX", "bibtex"],
    ["research.fieldnotes-layout.json", "layout"],
    ["photo.png", "unsupported"],
    ["noextension", "unsupported"],
    [".bib", "bibtex"],
  ])("%s → %s", (name, kind) => {
    expect(classifyFile({ name })).toBe(kind);
  });

  it("trusts the MIME type for a PDF without an extension", () => {
    expect(classifyFile({ name: "download", type: "application/pdf" })).toBe("pdf");
  });
});

describe("looksLikePdf", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it("accepts a normal header and one preceded by junk", () => {
    expect(looksLikePdf(enc("%PDF-1.7\n..."))).toBe(true);
    expect(looksLikePdf(enc("\n\n  junk before %PDF-1.4"))).toBe(true);
  });
  it("rejects other files, empty input and a marker beyond the first KB", () => {
    expect(looksLikePdf(enc("<html>not a pdf</html>"))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
    expect(looksLikePdf(enc(`${"x".repeat(2000)}%PDF-`))).toBe(false);
  });
});

describe("titleFromFileName", () => {
  it.each([
    ["Smith_2020_Deep_Learning.pdf", "Smith 2020 Deep Learning"],
    ["attention-is-all-you-need.pdf", "attention is all you need"],
    ["My Paper - draft.pdf", "My Paper - draft"],
    ["2304.03442v2.pdf", "2304.03442v2"],
    ["noext", "noext"],
    [".pdf", ".pdf"],
  ])("%s → %s", (name, title) => {
    expect(titleFromFileName(name)).toBe(title);
  });
});

describe("plausiblePdfTitle", () => {
  it.each([
    ["Attention Is All You Need", "Attention Is All You Need"],
    ["  Spaced \n title  here ", "Spaced title here"],
  ])("keeps %j", (input, expected) => {
    expect(plausiblePdfTitle(input)).toBe(expected);
  });

  it.each([
    "Microsoft Word - draft_v3.docx",
    "Untitled",
    "untitled document",
    "Document1",
    "PowerPoint Presentation",
    "paper.tex",
    "final.pdf",
    "2304.03442",
    "12345",
    "short",
    "",
    null,
    undefined,
    "x".repeat(400),
    "!!! ???",
  ])("rejects %j", (input) => {
    expect(plausiblePdfTitle(input as string)).toBeNull();
  });
});

describe("parseMarkdownMeta", () => {
  it("reads front matter, including list-style authors and a date", () => {
    const meta = parseMarkdownMeta(
      `---\ntitle: "Notes on Diffusion"\nauthors:\n  - Ada Lovelace\n  - Alan Turing\ndate: 2021-05-04\n---\n\n# Ignored heading\n\nThis note explains how diffusion models are trained and sampled in practice.\n`,
      "x.md",
    );
    expect(meta).toEqual({
      title: "Notes on Diffusion",
      authors: ["Ada Lovelace", "Alan Turing"],
      year: 2021,
      abstract: "This note explains how diffusion models are trained and sampled in practice.",
    });
  });

  it("handles quoted names in a YAML flow list without leaving stray quotes", () => {
    expect(parseMarkdownMeta('---\nauthors: ["Alice Smith", "Bob Jones"]\n---\nbody', "x.md").authors).toEqual(["Alice Smith", "Bob Jones"]);
    expect(parseMarkdownMeta("---\nauthors: ['Alice Smith', 'Bob Jones']\n---\nbody", "x.md").authors).toEqual(["Alice Smith", "Bob Jones"]);
    expect(parseMarkdownMeta('---\nauthor: "Alice Smith"\n---\nbody', "x.md").authors).toEqual(["Alice Smith"]);
  });

  it("accepts inline author lists and 'and'", () => {
    expect(parseMarkdownMeta("---\nauthor: [A One, B Two]\n---\nbody", "x.md").authors).toEqual(["A One", "B Two"]);
    expect(parseMarkdownMeta("---\nauthor: A One and B Two\n---\nbody", "x.md").authors).toEqual(["A One", "B Two"]);
  });

  it("falls back to the first H1, then to the file name", () => {
    expect(parseMarkdownMeta("intro\n\n# Real Title #\n\ntext", "file.md").title).toBe("Real Title");
    expect(parseMarkdownMeta("just text, no heading at all", "my_notes.md").title).toBe("my notes");
  });

  it("takes the first real paragraph as the abstract, skipping headings, lists, quotes, tables and code", () => {
    const text = [
      "# Title",
      "",
      "- a list item that is long enough to count",
      "",
      "> a quote that is long enough to count as well",
      "",
      "| a | table |",
      "",
      "```js",
      "const code = 'long enough to count if it were prose';",
      "```",
      "",
      "Here is the **actual** paragraph with a [link](https://example.org) in it.",
    ].join("\n");
    expect(parseMarkdownMeta(text, "x.md").abstract).toBe("Here is the actual paragraph with a link in it.");
  });

  it("clips long abstracts on a word boundary", () => {
    const abstract = parseMarkdownMeta(`# T\n\n${"word ".repeat(300)}`, "x.md").abstract ?? "";
    expect(abstract.length).toBeLessThanOrEqual(602);
    expect(abstract.endsWith("…")).toBe(true);
  });

  it("returns null abstract / year when there is nothing to find", () => {
    expect(parseMarkdownMeta("# Only a heading", "x.md")).toMatchObject({ abstract: null, year: null, authors: [] });
  });

  it("tolerates a BOM and Windows line endings in front matter", () => {
    expect(parseMarkdownMeta("\uFEFF---\r\ntitle: Windows\r\n---\r\nbody text that is long enough to be an abstract", "x.md").title).toBe("Windows");
  });

  it("ignores an unterminated front-matter block", () => {
    expect(parseMarkdownMeta("---\ntitle: Nope\nno closing fence", "x.md").title).not.toBe("Nope");
  });
});

describe("stripFrontMatter", () => {
  it("removes a leading YAML block, including with a BOM or CRLF", () => {
    expect(stripFrontMatter("---\ntitle: T\nauthors: [A]\n---\n\n# Body\n")).toBe("# Body\n");
    expect(stripFrontMatter("\uFEFF---\r\ntitle: T\r\n---\r\nBody")).toBe("Body");
  });

  it("leaves documents without front matter alone", () => {
    expect(stripFrontMatter("# Title\n\ntext")).toBe("# Title\n\ntext");
    expect(stripFrontMatter("")).toBe("");
  });

  it("does not eat a thematic break in the middle, or an unterminated block", () => {
    expect(stripFrontMatter("intro\n\n---\n\nmore")).toBe("intro\n\n---\n\nmore");
    expect(stripFrontMatter("---\ntitle: never closed\nbody")).toBe("---\ntitle: never closed\nbody");
  });
});

describe("fileId", () => {
  it("is stable for identical bytes and different otherwise", async () => {
    const a = new Uint8Array([1, 2, 3]).buffer;
    const b = new Uint8Array([1, 2, 3]).buffer;
    const c = new Uint8Array([1, 2, 4]).buffer;
    expect(await fileId(a)).toBe(await fileId(b));
    expect(await fileId(a)).not.toBe(await fileId(c));
    expect(await fileId(a)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("fileId without SubtleCrypto", () => {
  it("fallbackHash is deterministic, 32 hex chars and sensitive to every byte and to length", () => {
    const a = fallbackHash(new Uint8Array([1, 2, 3]));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(fallbackHash(new Uint8Array([1, 2, 3]))).toBe(a);
    expect(fallbackHash(new Uint8Array([1, 2, 4]))).not.toBe(a);
    expect(fallbackHash(new Uint8Array([1, 2, 3, 0]))).not.toBe(a);
    expect(fallbackHash(new Uint8Array([]))).toMatch(/^[0-9a-f]{32}$/);
  });

  it("has no collisions across many similar inputs", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(fallbackHash(new Uint8Array([i & 255, (i >> 8) & 255, 7])));
    expect(seen.size).toBe(20_000);
  });

  it("fileId uses the fallback when crypto.subtle is unavailable", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "x" }, configurable: true });
    try {
      const data = new Uint8Array([9, 9, 9]).buffer;
      expect(await fileId(data)).toBe(fallbackHash(new Uint8Array(data)));
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
  });
});

describe("library query", () => {
  const p = (over: Partial<Paper>): Paper => ({
    id: "x", source: "bibtex", title: "T", authors: [], year: null, venue: null, abstract: null, tldr: null,
    citationCount: null, url: null, pdfUrl: null, doi: null, arxivId: null, ...over,
  });
  const rows: Row[] = [
    { paper: p({ id: "a", title: "Éléments of Learning", authors: ["Jörg Müller"], year: 2010, venue: "Nature", citationCount: 5 }), addedAt: 1 },
    { paper: p({ id: "b", title: "Deep Learning", authors: ["Ian Goodfellow"], year: 2016, doi: "10.1000/dl", citationCount: 90_000, citekey: "goodfellow2016" }), addedAt: 3 },
    { paper: p({ id: "c", title: "10 Things", year: null, abstract: "about graph theory" }), addedAt: 2 },
  ];

  it("matches every term, ignoring case and accents, across fields", () => {
    expect(rows.filter((r) => matchesQuery(r.paper, "elements learning")).map((r) => r.paper.id)).toEqual(["a"]);
    expect(rows.filter((r) => matchesQuery(r.paper, "MULLER")).map((r) => r.paper.id)).toEqual(["a"]);
    expect(rows.filter((r) => matchesQuery(r.paper, "learning 2016")).map((r) => r.paper.id)).toEqual(["b"]);
    expect(rows.filter((r) => matchesQuery(r.paper, "goodfellow2016")).map((r) => r.paper.id)).toEqual(["b"]);
    expect(rows.filter((r) => matchesQuery(r.paper, "10.1000/dl")).map((r) => r.paper.id)).toEqual(["b"]);
    expect(rows.filter((r) => matchesQuery(r.paper, "graph")).map((r) => r.paper.id)).toEqual(["c"]);
    expect(rows.filter((r) => matchesQuery(r.paper, "nothing matches this"))).toEqual([]);
  });

  it("matches everything for an empty query", () => {
    expect(rows.every((r) => matchesQuery(r.paper, "   "))).toBe(true);
  });

  it("sorts by recency, title (natural, accent-insensitive), year and citations", () => {
    const ids = (s: Parameters<typeof sortRows>[1]) => sortRows(rows, s).map((r) => r.paper.id);
    expect(ids("added")).toEqual(["b", "c", "a"]);
    expect(ids("title")).toEqual(["c", "b", "a"]);
    expect(ids("year")).toEqual(["b", "a", "c"]);
    expect(ids("citations")).toEqual(["b", "a", "c"]);
  });

  it("does not mutate its input", () => {
    const before = rows.map((r) => r.paper.id);
    sortRows(rows, "title");
    expect(rows.map((r) => r.paper.id)).toEqual(before);
  });
});
