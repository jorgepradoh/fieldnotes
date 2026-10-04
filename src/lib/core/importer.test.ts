import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, unknown>();
vi.mock("./storage", () => ({
  loadJson: async (file: string, key: string) => disk.get(`${file}:${key}`) ?? null,
  saveJson: async (file: string, key: string, value: unknown) => {
    disk.set(`${file}:${key}`, structuredClone(value));
  },
}));

const toasts: { text: string; kind: string }[] = [];
vi.mock("./toast.svelte", () => ({
  toast: (text: string, kind = "info") => void toasts.push({ text, kind }),
}));

const ensured: string[] = [];
const imported: unknown[] = [];
vi.mock("./workspace.svelte", () => ({
  workspace: {
    whenLoaded: async () => undefined,
    ensure: (id: string) => {
      ensured.push(id);
      return true;
    },
    addImported: (parsed: unknown) => void imported.push(parsed),
  },
}));

const pdfInfo = vi.fn();
vi.mock("./pdf", () => ({ readPdfInfo: (...a: unknown[]) => pdfInfo(...a) }));

import { on } from "./bus.svelte";
import type { Paper } from "../sources/types";
import { attachPdfToEntry, describeSummary, importFiles } from "./importer";
import { library } from "./library.svelte";
import { registerModule } from "./registry";
import { MAX_PDF_BYTES } from "../library/files";

registerModule({ id: "notes", name: "Notes", icon: "", description: "", component: {} as never, defaultSize: { w: 4, h: 4 }, multiInstance: true });

const pdfBytes = (tag: string): Uint8Array => new TextEncoder().encode(`%PDF-1.7\n${tag}\n%%EOF`);
const pdf = (name: string, tag = name): File => new File([pdfBytes(tag) as BlobPart], name, { type: "application/pdf" });
const text = (name: string, body: string): File => new File([body], name);

// What the importer asked the rest of the app to open (the bus remembers globally, so listen per test).
const opened: Paper[] = [];
let stopListening: () => void = () => undefined;

afterEach(() => stopListening());

beforeEach(async () => {
  opened.length = 0;
  stopListening = on("paper:selected", ({ paper }) => void opened.push(paper));
  disk.clear();
  toasts.length = 0;
  ensured.length = 0;
  imported.length = 0;
  pdfInfo.mockReset();
  pdfInfo.mockResolvedValue({ title: null, author: null, pages: 1 });
  // Reset the shared singleton between tests.
  await library.ensureLoaded();
  for (const p of [...library.papers]) await library.remove(p.id);
  disk.clear();
});

describe("PDFs", () => {
  it("stores a dropped PDF, opens it in the Reader and tells the user", async () => {
    const summary = await importFiles([pdf("Smith_2020_Graph_Learning.pdf")]);
    expect(summary).toMatchObject({ pdfs: 1, failed: 0 });
    expect(library.papers).toHaveLength(1);
    expect(library.papers[0]).toMatchObject({ title: "Smith 2020 Graph Learning", source: "local", localFile: { kind: "pdf" } });
    expect(opened.map((p) => p.id)).toEqual([library.papers[0].id]);
    expect(ensured).toEqual(["reader", "library"]);
    expect(toasts.at(-1)?.text).toContain("Added 1 PDF to your library.");
  });

  it("uses a believable title and author from the PDF metadata", async () => {
    pdfInfo.mockResolvedValue({ title: "Attention Is All You Need", author: "Ashish Vaswani; Noam Shazeer", pages: 15 });
    await importFiles([pdf("1706.03762.pdf")]);
    expect(library.papers[0]).toMatchObject({ title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"] });
  });

  it("ignores junk metadata and metadata that cannot be read", async () => {
    pdfInfo.mockResolvedValue({ title: "Microsoft Word - draft.docx", author: null, pages: 1 });
    await importFiles([pdf("real_name.pdf", "one")]);
    pdfInfo.mockRejectedValue(new Error("password required"));
    await importFiles([pdf("locked file.pdf", "two")]);
    expect(library.papers.map((p) => p.title).sort()).toEqual(["locked file", "real name"]);
  });

  it("rejects a file that only claims to be a PDF", async () => {
    const summary = await importFiles([text("fake.pdf", "<html>nope</html>")]);
    expect(summary).toMatchObject({ pdfs: 0, failed: 1 });
    expect(library.papers).toEqual([]);
    expect(toasts.at(-1)).toMatchObject({ kind: "error" });
    expect(toasts.at(-1)?.text).toContain("doesn't look like a PDF");
    expect(ensured).toEqual([]);
  });

  it("rejects an oversized PDF before reading it", async () => {
    const big = pdf("huge.pdf");
    Object.defineProperty(big, "size", { value: MAX_PDF_BYTES + 1 });
    const summary = await importFiles([big]);
    expect(summary.failed).toBe(1);
    expect(toasts.at(-1)?.text).toMatch(/limit is 150 MB/);
  });

  it("recognises the same PDF dropped twice, but still opens it", async () => {
    await importFiles([pdf("a.pdf", "same")]);
    toasts.length = 0;
    const summary = await importFiles([pdf("renamed copy.pdf", "same")]);
    expect(summary).toMatchObject({ pdfs: 0, duplicates: 1 });
    expect(library.papers).toHaveLength(1);
    // Each of the two drops opened the same, single library entry.
    expect(opened.map((p) => p.id)).toEqual([library.papers[0].id, library.papers[0].id]);
    expect(toasts.at(-1)?.text).toContain("1 already was in it.");
    expect(toasts.at(-1)?.text).not.toContain("Added");
  });
});

describe("markdown", () => {
  it("reads title, authors and an abstract from the note", async () => {
    await importFiles([text("diffusion.md", "---\ntitle: Diffusion notes\nauthors: [Ada, Alan]\ndate: 2022-01-01\n---\n\nA short paragraph that works as the abstract of these notes.\n")]);
    expect(library.papers[0]).toMatchObject({
      title: "Diffusion notes",
      authors: ["Ada", "Alan"],
      year: 2022,
      abstract: "A short paragraph that works as the abstract of these notes.",
      localFile: { kind: "markdown", name: "diffusion.md" },
    });
    expect(toasts.at(-1)?.text).toContain("Added 1 markdown file");
  });
});

describe("BibTeX", () => {
  const bib = `@article{a, title={Paper A about graphs and their many uses}, author={Doe, Jane}, year={2020}, doi={10.1000/a}}
               @article{b, title={Paper B about trees and their many uses}, author={Roe, Rick}, year={2021}}
               @misc{c, title={Paper C}, eprint={2001.00001}, archivePrefix={arXiv}}`;

  it("imports every entry without opening anything", async () => {
    const summary = await importFiles([text("refs.bib", bib)]);
    expect(summary.bibEntries).toBe(3);
    expect(library.papers.map((p) => p.citekey).sort()).toEqual(["a", "b", "c"]);
    expect(opened).toEqual([]);
    expect(ensured).toEqual(["library"]);
    expect(toasts.at(-1)?.text).toContain("Added 3 BibTeX entries");
  });

  it("merges a second import instead of duplicating", async () => {
    await importFiles([text("refs.bib", bib)]);
    const again = await importFiles([text("refs-2.bib", bib + "\n@article{d, title={Paper D is the only new one here}, year={2022}}")]);
    expect(again).toMatchObject({ bibEntries: 1, duplicates: 3 });
    expect(library.papers).toHaveLength(4);
    expect(toasts.at(-1)?.text).toContain("Added 1 BibTeX entry to your library. 3 already were in it.");
  });

  it("reports parse problems but still imports the good entries", async () => {
    await importFiles([text("messy.bib", "@article{ok, title={Fine}}\n@article{broken, title = }\n@article{unclosed, title={x}")]);
    expect(library.papers.length).toBeGreaterThanOrEqual(2);
    expect(toasts.some((t) => /problem/.test(t.text))).toBe(true);
  });

  it("errors on a file with no entries", async () => {
    const summary = await importFiles([text("empty.bib", "% just a comment")]);
    expect(summary.failed).toBe(1);
    expect(toasts.at(-1)?.text).toContain("No BibTeX entries");
  });
});

describe("mixed drops and other files", () => {
  it("does not auto-open when several documents arrive together", async () => {
    await importFiles([pdf("one.pdf"), pdf("two.pdf"), text("refs.bib", "@misc{x, title={Some entry}}")]);
    expect(opened).toEqual([]);
    expect(ensured).toEqual(["library"]);
    expect(toasts.at(-1)?.text).toContain("Added 2 PDFs, 1 BibTeX entry to your library.");
  });

  it("keeps going after one bad file", async () => {
    const summary = await importFiles([text("notes.xyz", "?"), pdf("good.pdf")]);
    expect(summary).toMatchObject({ pdfs: 1, failed: 1 });
    expect(toasts.some((t) => t.kind === "error" && t.text.startsWith("notes.xyz"))).toBe(true);
  });

  it("hands layout files to the workspace", async () => {
    const layout = JSON.stringify({ format: "fieldnotes-layout", version: 1, name: "Shared", modules: [{ moduleId: "notes", position: { x: 0, y: 0, w: 4, h: 4 }, settings: {} }] });
    const summary = await importFiles([text("shared.fieldnotes-layout.json", layout)]);
    expect(summary.layouts).toBe(1);
    expect(imported).toHaveLength(1);
    expect(toasts.at(-1)?.text).toContain("Imported layout “Shared”");
  });

  it("rejects an oversized .json before reading it into memory", async () => {
    const huge = text("dataset.json", "{}");
    Object.defineProperty(huge, "size", { value: 50 * 1024 * 1024 });
    huge.text = () => Promise.reject(new Error("must not be read"));
    const summary = await importFiles([huge]);
    expect(summary.failed).toBe(1);
    expect(imported).toEqual([]);
    expect(toasts.at(-1)?.text).toContain("too large to be a layout");
  });

  it("reports an invalid layout file as an error", async () => {
    await importFiles([text("x.json", '{"hello":"world"}')]);
    expect(imported).toEqual([]);
    expect(toasts.at(-1)).toMatchObject({ kind: "error" });
    expect(toasts.at(-1)?.text).toContain("not a fieldnotes layout");
  });
});

describe("attachPdfToEntry", () => {
  it("attaches a PDF to a BibTeX record", async () => {
    await importFiles([text("refs.bib", "@article{a, title={Paper about attaching files to records}}")]);
    toasts.length = 0;
    expect(await attachPdfToEntry(library.papers[0].id, pdf("fulltext.pdf"))).toBe(true);
    expect(library.papers[0].localFile).toMatchObject({ kind: "pdf", name: "fulltext.pdf" });
    expect(toasts.at(-1)?.text).toContain("Attached “fulltext.pdf”");
  });

  it("refuses non-PDFs, fake PDFs and unknown records", async () => {
    await importFiles([text("refs.bib", "@article{a, title={Paper about attaching files to records}}")]);
    const id = library.papers[0].id;
    expect(await attachPdfToEntry(id, text("notes.md", "# hi"))).toBe(false);
    expect(await attachPdfToEntry(id, text("fake.pdf", "not a pdf"))).toBe(false);
    expect(await attachPdfToEntry("local:nope", pdf("ok.pdf"))).toBe(false);
    expect(library.papers[0].localFile).toBeUndefined();
    expect(toasts.filter((t) => t.kind === "error")).toHaveLength(3);
  });
});

describe("describeSummary", () => {
  it("is empty when nothing was added", () => {
    expect(describeSummary({ pdfs: 0, markdown: 0, bibEntries: 0, duplicates: 0, layouts: 0, failed: 2 })).toBe("");
  });
});
