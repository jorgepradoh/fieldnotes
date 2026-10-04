import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, unknown>();
vi.mock("./storage", () => ({
  loadJson: async (file: string, key: string) => disk.get(`${file}:${key}`) ?? null,
  saveJson: async (file: string, key: string, value: unknown) => {
    disk.set(`${file}:${key}`, structuredClone(value));
  },
}));

import { getBlob } from "./blobs";
import { LibraryState } from "./library.svelte";
import type { Paper } from "../sources/types";

function paper(over: Partial<Paper> & { id: string }): Paper {
  return {
    source: "bibtex",
    title: `Title of paper ${over.id} for the library tests`,
    authors: ["A Author"],
    year: 2020,
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

const buf = (...n: number[]): ArrayBuffer => new Uint8Array(n).buffer;
const doc = (name: string, data: ArrayBuffer, kind: "pdf" | "markdown" = "pdf") => ({
  data,
  mime: kind === "pdf" ? "application/pdf" : "text/markdown",
  name,
  kind,
  meta: { title: name, authors: [], year: null, abstract: null, venue: null },
});

async function fresh(): Promise<LibraryState> {
  const lib = new LibraryState();
  await lib.ensureLoaded();
  return lib;
}

beforeEach(() => disk.clear());

describe("adding", () => {
  it("adds new papers in one write and reports them", async () => {
    const lib = await fresh();
    const result = lib.addMany([paper({ id: "a" }), paper({ id: "b" })]);
    expect(result.added.map((p) => p.id)).toEqual(["a", "b"]);
    expect(result.merged).toBe(0);
    expect(lib.papers).toHaveLength(2);
    expect((disk.get("library.json:library") as { entries: unknown[] }).entries).toHaveLength(2);
  });

  it("merges a duplicate (same DOI, different id and wording) instead of adding it", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "a", doi: "10.1000/same", abstract: null, title: "One wording of this paper's title here" }));
    const result = lib.add(paper({ id: "b", doi: "https://doi.org/10.1000/SAME", abstract: "Now with an abstract", title: "A different wording of it" }));
    expect(result.added).toEqual([]);
    expect(result.merged).toBe(1);
    expect(lib.papers).toHaveLength(1);
    expect(lib.papers[0]).toMatchObject({ id: "a", abstract: "Now with an abstract" });
    expect(lib.papers[0].sources).toBeUndefined();
  });

  it("matches by arXiv id and by identical long title", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "a", arxivId: "1706.03762", title: "Attention wording one that is long enough to key" }));
    expect(lib.add(paper({ id: "b", arxivId: "1706.03762v5", title: "Totally different text so only the id matches" })).merged).toBe(1);
    lib.add(paper({ id: "c", title: "A sufficiently long and distinctive title for matching" }));
    expect(lib.add(paper({ id: "d", title: "A sufficiently long and distinctive title for matching!" })).merged).toBe(1);
    expect(lib.papers).toHaveLength(2);
  });

  it("de-duplicates within a single batch", async () => {
    const lib = await fresh();
    const result = lib.addMany([paper({ id: "a", doi: "10.1000/x" }), paper({ id: "b", doi: "10.1000/x" }), paper({ id: "c" })]);
    expect(result.added.map((p) => p.id)).toEqual(["a", "c"]);
    expect(result.merged).toBe(1);
  });

  it("keeps the library's own id and file when merging in a search result", async () => {
    const lib = await fresh();
    const { paper: local } = await lib.addDocument(doc("x.pdf", buf(1, 2, 3)));
    lib.add({ ...paper({ id: "s2:1", source: "semantic-scholar", title: local.title }), doi: null });
    // Same long-enough title matches the local entry; the file reference must survive.
    const after = lib.get(local.id);
    expect(after?.localFile?.id).toBe(local.localFile?.id);
  });

  it("does not write when nothing changed", async () => {
    const lib = await fresh();
    lib.addMany([]);
    expect(disk.has("library.json:library")).toBe(false);
  });

  it("find locates a saved paper by identity, not only by id", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "saved", doi: "10.1000/found" }));
    expect(lib.find(paper({ id: "other-id", doi: "10.1000/found" }))?.id).toBe("saved");
    expect(lib.find(paper({ id: "unknown", doi: "10.1000/nope" }))).toBeUndefined();
  });
});

describe("documents", () => {
  it("stores the bytes and creates an entry that points at them", async () => {
    const lib = await fresh();
    const { paper: p, isNew } = await lib.addDocument(doc("deep learning.pdf", buf(1, 2, 3)));
    expect(isNew).toBe(true);
    expect(p).toMatchObject({ source: "local", title: "deep learning.pdf", localFile: { kind: "pdf", name: "deep learning.pdf", size: 3 } });
    expect(p.id).toBe(`local:${p.localFile?.id}`);
    expect(Array.from((await lib.fileBytes(p.localFile!))!)).toEqual([1, 2, 3]);
  });

  it("recognises identical bytes under another name and does not store them twice", async () => {
    const lib = await fresh();
    const first = await lib.addDocument(doc("a.pdf", buf(7, 7, 7)));
    const second = await lib.addDocument(doc("renamed.pdf", buf(7, 7, 7)));
    expect(second.isNew).toBe(false);
    expect(second.paper.id).toBe(first.paper.id);
    expect(lib.papers).toHaveLength(1);
  });

  it("reads markdown back as text", async () => {
    const lib = await fresh();
    const { paper: p } = await lib.addDocument(doc("n.md", new TextEncoder().encode("# héllo ✓").buffer as ArrayBuffer, "markdown"));
    expect(await lib.fileText(p.localFile!)).toBe("# héllo ✓");
  });

  it("returns null for a file that is gone", async () => {
    const lib = await fresh();
    expect(await lib.fileBytes({ id: "missing", name: "x", kind: "pdf", size: 1 })).toBeNull();
    expect(await lib.fileText({ id: "missing", name: "x", kind: "markdown", size: 1 })).toBeNull();
  });
});

describe("documents that match an existing record", () => {
  const LONG = "A rather long title that is distinctive enough to match on";

  it("keeps two different files with the same title as two entries (and both files)", async () => {
    const lib = await fresh();
    const first = await lib.addDocument({ ...doc("a.pdf", buf(1, 1)), meta: { title: LONG, authors: [], year: null, abstract: null, venue: null } });
    const second = await lib.addDocument({ ...doc("b.pdf", buf(2, 2)), meta: { title: LONG, authors: [], year: null, abstract: null, venue: null } });
    expect(lib.papers).toHaveLength(2);
    expect(second.paper.id).not.toBe(first.paper.id);
    expect(await getBlob(first.paper.localFile!.id)).not.toBeNull();
    expect(await getBlob(second.paper.localFile!.id)).not.toBeNull();
    expect(lib.get(second.paper.id)?.localFile?.name).toBe("b.pdf");
  });

  it("attaches a dropped file to a matching BibTeX record that has none, and returns that record", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "bib:1", title: LONG, doi: "10.1000/x" }));
    const { paper: stored } = await lib.addDocument({ ...doc("full.pdf", buf(3)), meta: { title: LONG, authors: [], year: null, abstract: null, venue: null } });
    expect(lib.papers).toHaveLength(1);
    expect(stored.id).toBe("bib:1");
    expect(stored.doi).toBe("10.1000/x");
    expect(stored.localFile).toMatchObject({ name: "full.pdf", kind: "pdf" });
    expect(lib.get("bib:1")?.localFile?.name).toBe("full.pdf");
  });

  it("does not replace the file of a matching record that already has one", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "bib:1", title: LONG }));
    await lib.attachFile("bib:1", buf(1), "first.pdf", "application/pdf");
    const second = await lib.addDocument({ ...doc("second.pdf", buf(2)), meta: { title: LONG, authors: [], year: null, abstract: null, venue: null } });
    expect(lib.papers).toHaveLength(2);
    expect(lib.get("bib:1")?.localFile?.name).toBe("first.pdf");
    expect(second.paper.localFile?.name).toBe("second.pdf");
    expect(await getBlob(second.paper.localFile!.id)).not.toBeNull();
  });
});

describe("loading", () => {
  it("refuses to write before the stored library has been read", () => {
    const lib = new LibraryState();
    expect(() => lib.addMany([paper({ id: "x" })])).toThrow(/still loading/);
    expect(disk.has("library.json:library")).toBe(false);
  });
});

describe("attaching and removing", () => {
  it("attaches a PDF to a BibTeX entry", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "bib:1" }));
    const updated = await lib.attachFile("bib:1", buf(5, 5), "full text.pdf", "application/pdf");
    expect(updated?.localFile).toMatchObject({ kind: "pdf", name: "full text.pdf", size: 2 });
    expect(lib.get("bib:1")?.localFile?.name).toBe("full text.pdf");
    expect(await lib.attachFile("nope", buf(1), "x.pdf", "application/pdf")).toBeNull();
  });

  it("replacing an attachment deletes the old bytes", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "bib:1" }));
    const first = await lib.attachFile("bib:1", buf(1), "v1.pdf", "application/pdf");
    await lib.attachFile("bib:1", buf(2), "v2.pdf", "application/pdf");
    expect(await getBlob(first!.localFile!.id)).toBeNull();
  });

  it("removing an entry deletes its file, unless another entry still uses it", async () => {
    const lib = await fresh();
    const { paper: p } = await lib.addDocument(doc("a.pdf", buf(9)));
    lib.add(paper({ id: "bib:shared" }));
    await lib.attachFile("bib:shared", buf(9), "same-bytes.pdf", "application/pdf");

    await lib.remove(p.id);
    expect(lib.get(p.id)).toBeUndefined();
    expect(await getBlob(p.localFile!.id)).not.toBeNull(); // still referenced by bib:shared

    await lib.remove("bib:shared");
    expect(await getBlob(p.localFile!.id)).toBeNull();
  });

  it("removing an unknown id is a no-op", async () => {
    const lib = await fresh();
    await expect(lib.remove("nope")).resolves.toBeUndefined();
  });
});

describe("persistence", () => {
  it("survives a reload", async () => {
    const lib = await fresh();
    lib.addMany([paper({ id: "a" }), paper({ id: "b" })]);
    const again = await fresh();
    expect(again.papers.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("drops malformed stored entries instead of crashing", async () => {
    disk.set("library.json:library", {
      version: 1,
      entries: [{ paper: paper({ id: "ok" }), addedAt: 1 }, { paper: { id: 5 }, addedAt: 2 }, "junk", null, { addedAt: 3 }],
    });
    const lib = await fresh();
    expect(lib.papers.map((p) => p.id)).toEqual(["ok"]);
  });

  it("starts empty for a missing or garbage file", async () => {
    disk.set("library.json:library", "garbage");
    expect((await fresh()).papers).toEqual([]);
  });

  it("reads the first desktop build's bare list of { paper, savedAt }", async () => {
    disk.set("library.json:library", [
      { paper: paper({ id: "old-a" }), savedAt: "2026-06-16T10:00:00.000Z" },
      { paper: paper({ id: "old-b" }), savedAt: "2026-06-16T11:30:00.000Z" },
    ]);
    const lib = await fresh();
    expect(lib.entries.map((e) => [e.paper.id, e.addedAt])).toEqual([
      ["old-a", Date.parse("2026-06-16T10:00:00.000Z")],
      ["old-b", Date.parse("2026-06-16T11:30:00.000Z")],
    ]);
  });

  it("rewrites a migrated library in the current format on the first change", async () => {
    disk.set("library.json:library", [{ paper: paper({ id: "old" }), savedAt: "2026-06-16T10:00:00.000Z" }]);
    const lib = await fresh();
    lib.add(paper({ id: "new" }));
    const stored = disk.get("library.json:library") as { version: number; entries: { paper: { id: string } }[] };
    expect(stored.version).toBe(1);
    expect(stored.entries.map((e) => e.paper.id)).toEqual(["old", "new"]);
  });

  it("keeps a legacy entry whose timestamp can't be read", async () => {
    disk.set("library.json:library", [{ paper: paper({ id: "odd" }), savedAt: "not a date" }]);
    const lib = await fresh();
    expect(lib.papers.map((p) => p.id)).toEqual(["odd"]);
    expect(Number.isFinite(lib.entries[0].addedAt)).toBe(true);
  });
});
