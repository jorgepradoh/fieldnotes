import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, unknown>();
/** Stores from before the library took over (queue.json, annotations.json), as the old code left them. */
const oldStores = new Map<string, unknown>();
vi.mock("./storage", () => ({
  loadJson: async (file: string, key: string) => disk.get(`${file}:${key}`) ?? null,
  loadLegacy: async (file: string, key: string) => {
    const value = oldStores.get(`${file}:${key}`);
    if (value instanceof Error) throw value;
    return value ?? null;
  },
  saveJson: (file: string, key: string, value: unknown): Promise<void> => {
    saves.started++;
    if (saves.throwSync) throw new Error("threw before returning a promise");
    if (saves.failBackup && key.endsWith(".backup")) return Promise.reject(new Error("backup store failed"));
    return (async () => {
      if (saves.gate) await saves.gate;
      if (saves.fail) throw new Error("disk full");
      disk.set(`${file}:${key}`, structuredClone(value));
      saves.finished++;
    })();
  },
}));
const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("./toast.svelte", () => ({ toast: toastSpy }));

/** Lets a test hold writes open, fail them (asynchronously or by throwing at once), and count them. */
const saves: { started: number; finished: number; gate: Promise<void> | null; fail: boolean; throwSync: boolean; failBackup: boolean } = {
  started: 0,
  finished: 0,
  gate: null,
  fail: false,
  throwSync: false,
  failBackup: false,
};

import { getBlob } from "./blobs";
import { LibraryState } from "./library.svelte";
import { queueColumns } from "../library/queue";
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

/** Lets every pending write (and the follow-up a burst collapses into) finish. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  toastSpy.mockClear();
  disk.clear();
  oldStores.clear();
  Object.assign(saves, { started: 0, finished: 0, gate: null, fail: false, throwSync: false, failBackup: false });
});

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
    expect(stored.version).toBe(2);
    expect(stored.entries.map((e) => e.paper.id)).toEqual(["old", "new"]);
  });

  it("keeps a legacy entry whose timestamp can't be read", async () => {
    disk.set("library.json:library", [{ paper: paper({ id: "odd" }), savedAt: "not a date" }]);
    const lib = await fresh();
    expect(lib.papers.map((p) => p.id)).toEqual(["odd"]);
    expect(Number.isFinite(lib.entries[0].addedAt)).toBe(true);
  });
});

describe("the record", () => {
  it("idFor finds a saved paper under any of its identities and is undefined for an unsaved one", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "arxiv:1706.03762", arxivId: "1706.03762", doi: "10.48550/arXiv.1706.03762" }));
    expect(lib.idFor(paper({ id: "arxiv:1706.03762" }))).toBe("arxiv:1706.03762");
    expect(lib.idFor(paper({ id: "s2:abc", doi: "10.48550/arxiv.1706.03762" }))).toBe("arxiv:1706.03762");
    expect(lib.idFor(paper({ id: "oa:W1", arxivId: "1706.03762v7" }))).toBe("arxiv:1706.03762");
    expect(lib.idFor(paper({ id: "s2:other" }))).toBeUndefined();
  });

  it("ensure returns the existing record for the same paper from another source, without adding one", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "arxiv:1", doi: "10.1000/same" }));
    expect(lib.ensure(paper({ id: "s2:9", doi: "10.1000/SAME" }))).toBe("arxiv:1");
    expect(lib.entries).toHaveLength(1);
  });

  it("ensure saves a paper that is not in the library and returns its id; asking again changes nothing", async () => {
    const lib = await fresh();
    const id = lib.ensure(paper({ id: "s2:new" }));
    expect(id).toBe("s2:new");
    expect(lib.entries).toHaveLength(1);
    expect(lib.ensure(paper({ id: "s2:new" }))).toBe(id);
    expect(lib.entries).toHaveLength(1);
  });

  it("ensure does not rewrite the file when the paper is already saved", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "a" }));
    await vi.waitFor(() => expect(saves.finished).toBe(1));
    lib.ensure(paper({ id: "a" }));
    await Promise.resolve();
    expect(saves.started).toBe(1);
  });

  it("refuses to write before the stored library has been read", () => {
    const lib = new LibraryState();
    expect(() => lib.ensure(paper({ id: "x" }))).toThrow(/still loading/);
    expect(() => lib.setStatus("x", "reading")).toThrow(/still loading/);
    expect(() => lib.setNote("x", "n")).toThrow(/still loading/);
    expect(() => lib.addTag("x", "t")).toThrow(/still loading/);
    expect(() => lib.removeTag("x", "t")).toThrow(/still loading/);
    expect(disk.has("library.json:library")).toBe(false);
  });
});

describe("status, notes and tags", () => {
  it("sets a status and puts the paper in its column", async () => {
    const lib = await fresh();
    lib.addMany([paper({ id: "a" }), paper({ id: "b" })]);
    expect(lib.setStatus("a", "reading", 100)).toBe(true);
    expect(lib.setStatus("b", "reading", 200)).toBe(true);
    expect(lib.statusOf("a")).toBe("reading");
    expect(queueColumns(lib.entries)["reading"].map((e) => e.paper.id)).toEqual(["b", "a"]);
    expect(queueColumns(lib.entries)["done"]).toEqual([]);
    expect(lib.setStatus("a", null)).toBe(true);
    expect(lib.statusOf("a")).toBeUndefined();
    expect(lib.papers.map((p) => p.id)).toEqual(["a", "b"]); // clearing the status never removes the paper
  });

  it("returns false for an entry that does not exist", async () => {
    const lib = await fresh();
    expect(lib.setStatus("nope", "done")).toBe(false);
    expect(lib.setNote("nope", "x")).toBe(false);
    expect(lib.addTag("nope", "x")).toBe("invalid");
    expect(lib.removeTag("nope", "x")).toBe(false);
  });

  it("writes a note and clears it on blank", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "a" }));
    lib.setNote("a", "# Notes\n\nbody");
    expect(lib.noteOf("a")).toBe("# Notes\n\nbody");
    lib.setNote("a", "  ");
    expect(lib.noteOf("a")).toBe("");
    expect(lib.entries[0]).not.toHaveProperty("note");
    expect(lib.noteOf("missing")).toBe("");
  });

  it("adds, normalises and removes tags and counts them", async () => {
    const lib = await fresh();
    lib.addMany([paper({ id: "a" }), paper({ id: "b" })]);
    expect(lib.addTag("a", " #Vision ")).toBe("added");
    expect(lib.addTag("a", "vision")).toBe("exists");
    expect(lib.addTag("a", "  , ")).toBe("invalid");
    lib.addTag("b", "vision");
    lib.addTag("b", "nlp");
    expect(lib.tags()).toEqual([
      { tag: "vision", count: 2 },
      { tag: "nlp", count: 1 },
    ]);
    expect(lib.removeTag("a", "VISION")).toBe(true);
    expect(lib.entries[0]).not.toHaveProperty("tags");
    expect(lib.tags()).toEqual([
      { tag: "nlp", count: 1 },
      { tag: "vision", count: 1 },
    ]);
  });

  it("does not write when nothing changes", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "a" }));
    lib.setStatus("a", "reading");
    lib.setNote("a", "n");
    lib.addTag("a", "t");
    await vi.waitFor(() => expect(saves.started).toBeGreaterThan(0));
    await settle();
    const before = saves.started;
    lib.setStatus("a", "reading");
    lib.setNote("a", "n");
    lib.addTag("a", "t");
    lib.removeTag("a", "absent");
    lib.setStatus("missing", null);
    await settle();
    expect(saves.started).toBe(before);
  });

  it("keeps status, tags and notes when the same paper is saved again from another source", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "arxiv:1", doi: "10.1000/x" }));
    lib.setStatus("arxiv:1", "reading");
    lib.addTag("arxiv:1", "keep");
    lib.setNote("arxiv:1", "mine");
    lib.add(paper({ id: "s2:2", doi: "10.1000/x", abstract: "fresh abstract" }));
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]).toMatchObject({ status: "reading", tags: ["keep"], note: "mine" });
    expect(lib.entries[0].paper.abstract).toBe("fresh abstract");
  });

  it("removing an entry takes its status and tags with it but keeps its note, which returns if the paper is saved again", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "a" }));
    lib.setStatus("a", "done");
    lib.addTag("a", "gone");
    lib.setNote("a", "a long note I wrote");
    await lib.remove("a");
    expect(queueColumns(lib.entries)["done"]).toEqual([]);
    expect(lib.tags()).toEqual([]);
    expect(lib.orphans.get("a")).toBe("a long note I wrote");
    await settle(); // the follow-up write that carries the removal
    expect((disk.get("library.json:library") as { orphanNotes: Record<string, string> }).orphanNotes).toEqual({ a: "a long note I wrote" });

    lib.add(paper({ id: "a" }));
    expect(lib.noteOf("a")).toBe("a long note I wrote");
    expect(lib.statusOf("a")).toBeUndefined();
    expect(lib.tags()).toEqual([]);
    expect(lib.orphans.size).toBe(0);
  });
});

describe("notes waiting for a paper", () => {
  it("are given to the paper when it is saved", async () => {
    disk.set("library.json:library", { version: 2, entries: [], orphanNotes: { "s2:abc": "written before the library was the record" } });
    const lib = await fresh();
    expect(lib.hasOrphanNote(paper({ id: "s2:abc" }))).toBe(true);
    expect(lib.hasOrphanNote(paper({ id: "s2:zzz" }))).toBe(false);
    lib.add(paper({ id: "s2:abc" }));
    expect(lib.noteOf("s2:abc")).toBe("written before the library was the record");
    expect(lib.hasOrphanNote(paper({ id: "s2:abc" }))).toBe(false);
    expect((disk.get("library.json:library") as { orphanNotes?: unknown }).orphanNotes).toBeUndefined();
  });

  it("are given to the record the paper turns out to be, when ensure finds it under another id", async () => {
    disk.set("library.json:library", { version: 2, entries: [{ paper: paper({ id: "arxiv:1", doi: "10.1000/x" }), addedAt: 1 }], orphanNotes: { "s2:9": "old note" } });
    const lib = await fresh();
    expect(lib.ensure(paper({ id: "s2:9", doi: "10.1000/x" }))).toBe("arxiv:1");
    expect(lib.noteOf("arxiv:1")).toBe("old note");
    expect(lib.hasOrphanNote(paper({ id: "s2:9" }))).toBe(false);
  });
});

describe("importing the old queue and annotations", () => {
  const OLD_QUEUE = [
    { paper: paper({ id: "s2:q2", title: "Second queued paper, long enough title" }), status: "reading", addedAt: "2026-09-02T10:00:00.000Z" },
    { paper: paper({ id: "s2:q1", title: "First queued paper, long enough title" }), status: "to-read", addedAt: "2026-09-01T10:00:00.000Z" },
  ];
  const OLD_NOTES = { "s2:q1": "note on a queued paper", "s2:unsaved": "note on a paper never saved" };
  const stored = () => disk.get("library.json:library") as { version: number; entries: LibraryStored[]; orphanNotes?: Record<string, string>; migrated?: Record<string, boolean> };
  type LibraryStored = { paper: { id: string }; addedAt: number; status?: string; statusAt?: number; note?: string };

  it("brings the queue and the notes into the library and records that it did", async () => {
    oldStores.set("queue.json:queue", OLD_QUEUE);
    oldStores.set("annotations.json:annotations", OLD_NOTES);
    const lib = await fresh();
    expect(lib.entries.map((e) => [e.paper.id, e.status, e.note])).toEqual([
      ["s2:q1", "to-read", "note on a queued paper"],
      ["s2:q2", "reading", undefined],
    ]);
    expect([...lib.orphans]).toEqual([["s2:unsaved", "note on a paper never saved"]]);
    // It is written straight away, flags included, so it cannot run twice.
    expect(stored()).toMatchObject({ version: 2, migrated: { queue: true, annotations: true }, orphanNotes: { "s2:unsaved": "note on a paper never saved" } });
    expect(stored().entries.map((e) => e.status)).toEqual(["to-read", "reading"]);
  });

  it("does not run again: what the user changed afterwards stays changed", async () => {
    oldStores.set("queue.json:queue", OLD_QUEUE);
    oldStores.set("annotations.json:annotations", OLD_NOTES);
    const first = await fresh();
    first.setStatus("s2:q1", null);
    first.setNote("s2:q1", "");
    first.add(paper({ id: "s2:unsaved" }));
    first.setNote("s2:unsaved", "rewritten");
    await settle();
    // The old stores are still there (never deleted)…
    expect(oldStores.size).toBe(2);
    // …but the next launch must not import them again.
    const second = await fresh();
    expect(second.entries.find((e) => e.paper.id === "s2:q1")).not.toHaveProperty("status");
    expect(second.entries.find((e) => e.paper.id === "s2:q1")).not.toHaveProperty("note");
    expect(second.noteOf("s2:unsaved")).toBe("rewritten");
    expect(second.entries).toHaveLength(3);
  });

  it("leaves the old stores exactly as they were", async () => {
    const queue = structuredClone(OLD_QUEUE);
    const notes = structuredClone(OLD_NOTES);
    oldStores.set("queue.json:queue", queue);
    oldStores.set("annotations.json:annotations", notes);
    await fresh();
    expect(oldStores.get("queue.json:queue")).toEqual(OLD_QUEUE);
    expect(oldStores.get("annotations.json:annotations")).toEqual(OLD_NOTES);
  });

  it("writes nothing when there is nothing to import", async () => {
    await fresh();
    await settle();
    expect(saves.started).toBe(0);
    expect(disk.has("library.json:library")).toBe(false);
  });

  it("imports into an existing library, merging a queued paper into the entry it matches", async () => {
    disk.set("library.json:library", { version: 1, entries: [{ paper: paper({ id: "bib:1", doi: "10.1000/x" }), addedAt: 5 }] });
    oldStores.set("queue.json:queue", [{ paper: paper({ id: "s2:9", doi: "10.1000/x" }), status: "done", addedAt: "2026-09-01T10:00:00.000Z" }]);
    oldStores.set("annotations.json:annotations", { "s2:9": "annotated under the search result's id" });
    const lib = await fresh();
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]).toMatchObject({ addedAt: 5, status: "done" });
    expect(lib.entries[0].paper.id).toBe("bib:1");
    // The note was keyed by the id the paper had in search, which is the id of the queued copy that
    // merged into bib:1: it lands on that record straight away rather than waiting as an orphan.
    expect(lib.noteOf("bib:1")).toBe("annotated under the search result's id");
    expect(lib.hasOrphanNote(paper({ id: "s2:9" }))).toBe(false);
  });

  it("gives a note to the record its paper merged into, even when it was annotated under another id", async () => {
    oldStores.set("queue.json:queue", [
      { paper: paper({ id: "s2:abc", doi: "10.1000/same", title: "Merged paper, long enough title" }), status: "reading", addedAt: "2026-09-01T00:00:00.000Z" },
      { paper: paper({ id: "arxiv:123", doi: "10.1000/same", title: "Merged paper, long enough title" }), status: "to-read", addedAt: "2026-09-02T00:00:00.000Z" },
    ]);
    oldStores.set("annotations.json:annotations", { "arxiv:123": "note under the other id" });
    const lib = await fresh();
    expect(lib.entries).toHaveLength(1);
    expect(lib.noteOf("s2:abc")).toBe("note under the other id");
    expect(lib.orphans.size).toBe(0);
  });

  it("still loads, and tries again next time, when an old store cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    oldStores.set("queue.json:queue", new Error("store file is corrupt"));
    oldStores.set("annotations.json:annotations", { "s2:x": "this one is fine" });
    disk.set("library.json:library", { version: 2, entries: [{ paper: paper({ id: "kept" }), addedAt: 1 }] });
    const lib = await fresh();
    expect(lib.loaded).toBe(true);
    expect(lib.papers.map((p) => p.id)).toEqual(["kept"]);
    expect(lib.orphans.get("s2:x")).toBe("this one is fine");
    expect(error).toHaveBeenCalled();
    expect(stored().migrated).toEqual({ annotations: true }); // not queue: it is retried
    error.mockRestore();
  });

  it("tells the user how many old items could not be imported, and still imports the rest", async () => {
    oldStores.set("queue.json:queue", [...OLD_QUEUE, null, { paper: { id: 5 } }, "junk"]);
    oldStores.set("annotations.json:annotations", { ...OLD_NOTES, broken: { not: "text" } });
    const lib = await fresh();
    expect(lib.entries.map((e) => e.paper.id)).toEqual(["s2:q1", "s2:q2"]);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("4 items from your old reading queue or annotations could not be imported"), "info");
  });

  it("says nothing when everything in the old stores could be imported", async () => {
    oldStores.set("queue.json:queue", OLD_QUEUE);
    oldStores.set("annotations.json:annotations", OLD_NOTES);
    await fresh();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("ignores an old store that is not the shape it expects, without flagging it", async () => {
    oldStores.set("queue.json:queue", { not: "a list" });
    oldStores.set("annotations.json:annotations", ["not", "a", "map"]);
    const lib = await fresh();
    expect(lib.entries).toEqual([]);
    await settle();
    expect(disk.has("library.json:library")).toBe(false);
  });

  it("does not look at the old stores once both are flagged", async () => {
    disk.set("library.json:library", { version: 2, entries: [], migrated: { queue: true, annotations: true } });
    oldStores.set("queue.json:queue", OLD_QUEUE);
    oldStores.set("annotations.json:annotations", OLD_NOTES);
    expect((await fresh()).entries).toEqual([]);
  });
});

describe("what is stored", () => {
  it("round-trips status, tags and notes", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "a" }));
    lib.setStatus("a", "reading", 500);
    lib.addTag("a", "x");
    lib.setNote("a", "a note");
    await settle();
    const again = await fresh();
    expect(again.entries[0]).toMatchObject({ status: "reading", statusAt: 500, tags: ["x"], note: "a note" });
  });

  it("writes back fields it does not know, on entries and at the top of the file", async () => {
    disk.set("library.json:library", {
      version: 2,
      entries: [{ paper: paper({ id: "a" }), addedAt: 1, color: "red" }],
      collections: [{ id: "c1", name: "From a newer build" }],
    });
    const lib = await fresh();
    lib.setNote("a", "n");
    await settle();
    const file = disk.get("library.json:library") as { entries: { color?: string }[]; collections?: unknown; version: number };
    expect(file.version).toBe(2);
    expect(file.entries[0].color).toBe("red");
    expect(file.collections).toEqual([{ id: "c1", name: "From a newer build" }]);
  });

  it("starts from the bare list of the first build and upgrades it on the first change", async () => {
    disk.set("library.json:library", [{ paper: paper({ id: "june" }), savedAt: "2026-06-16T10:00:00.000Z" }]);
    const lib = await fresh();
    lib.setStatus("june", "to-read");
    const file = disk.get("library.json:library") as { version: number; entries: { paper: { id: string }; status?: string }[] };
    expect(file.version).toBe(2);
    expect(file.entries).toMatchObject([{ paper: { id: "june" }, status: "to-read" }]);
  });
});

describe("writing", () => {
  afterEach(() => {
    saves.gate = null;
  });

  it("collapses writes made while one is in flight into one follow-up with the latest state", async () => {
    const lib = await fresh();
    let release!: () => void;
    saves.gate = new Promise<void>((resolve) => (release = resolve));
    lib.add(paper({ id: "a" })); // goes out at once, then waits on the gate
    lib.setNote("a", "n1");
    lib.setNote("a", "n2");
    lib.addTag("a", "t");
    lib.add(paper({ id: "b" }));
    expect(saves.started).toBe(1);
    saves.gate = null;
    release();
    await vi.waitFor(() => expect(saves.finished).toBe(2));
    expect(saves.started).toBe(2);
    const file = disk.get("library.json:library") as { entries: { paper: { id: string }; note?: string; tags?: string[] }[] };
    expect(file.entries.map((e) => e.paper.id)).toEqual(["a", "b"]);
    expect(file.entries[0]).toMatchObject({ note: "n2", tags: ["t"] });
  });

  describe("when a write fails", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      toastSpy.mockClear();
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    const quiet = () => vi.spyOn(console, "error").mockImplementation(() => undefined);
    const advance = async (ms: number) => vi.advanceTimersByTimeAsync(ms);
    const stored = () => (disk.get("library.json:library") as { entries: { paper: { id: string }; note?: string }[] } | undefined)?.entries;

    it("tells the user once, not on every attempt", async () => {
      const error = quiet();
      const lib = await fresh();
      saves.fail = true;
      lib.add(paper({ id: "a" })); // attempt 1 fails; retry in 5 s
      await advance(0);
      lib.add(paper({ id: "b" })); // no attempt of its own
      await advance(5_000); // attempt 2 fails; retry in 10 s
      expect(saves.started).toBe(2);
      await advance(10_000); // attempt 3 fails
      expect(saves.started).toBe(3);
      expect(toastSpy).toHaveBeenCalledTimes(1);
      expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("Could not save your library"), "error");
      error.mockRestore();
    });

    it("retries on its own, with a growing delay, and the data lands once the disk recovers", async () => {
      const error = quiet();
      const lib = await fresh();
      saves.fail = true;
      lib.add(paper({ id: "a" })); // attempt 1 fails; retry in 5 s
      await advance(0);
      expect(saves.started).toBe(1);
      await advance(4_999);
      expect(saves.started).toBe(1);
      await advance(1); // attempt 2 fails; retry in 10 s
      expect(saves.started).toBe(2);
      await advance(9_999);
      expect(saves.started).toBe(2);
      saves.fail = false; // the disk recovers; no further edit is made
      await advance(1);
      expect(saves.finished).toBe(1);
      expect(stored()).toHaveLength(1);
      await advance(120_000);
      expect(saves.started).toBe(3); // and it stops retrying
      error.mockRestore();
    });

    it("tells the user again after a success, if the next failure is a new one", async () => {
      const error = quiet();
      const lib = await fresh();
      saves.fail = true;
      lib.add(paper({ id: "a" }));
      await advance(0);
      saves.fail = false;
      await advance(5_000);
      expect(toastSpy).toHaveBeenCalledTimes(1);
      saves.fail = true;
      lib.add(paper({ id: "b" }));
      await advance(0);
      expect(toastSpy).toHaveBeenCalledTimes(2);
      error.mockRestore();
    });

    it("caps the delay between retries", async () => {
      const error = quiet();
      const lib = await fresh();
      saves.fail = true;
      lib.add(paper({ id: "a" }));
      await advance(0);
      for (const wait of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) await advance(wait);
      expect(saves.started).toBe(7);
      error.mockRestore();
    });

    it("edits made while failing add no attempts of their own; the retry writes the latest state", async () => {
      const error = quiet();
      const lib = await fresh();
      saves.fail = true;
      lib.add(paper({ id: "a" }));
      await advance(0);
      expect(saves.started).toBe(1);
      for (let i = 0; i < 150; i++) {
        lib.setNote("a", `edit ${i}`);
        await advance(400);
      }
      // 60 s of one edit every 400 ms against a failing store: attempts follow the backoff, not the edits.
      expect(saves.started).toBeLessThanOrEqual(7);
      saves.fail = false;
      await advance(60_000);
      expect(stored()?.[0].note).toBe("edit 149");
      error.mockRestore();
    });

    it("an edit made during a write that then fails does not trigger an immediate extra attempt", async () => {
      const error = quiet();
      const lib = await fresh();
      let release!: () => void;
      saves.gate = new Promise<void>((resolve) => (release = resolve));
      saves.fail = true;
      lib.add(paper({ id: "a" })); // in flight, held on the gate
      lib.setNote("a", "typed while the write was in flight");
      saves.gate = null;
      release();
      await advance(0);
      expect(saves.started).toBe(1);
      saves.fail = false;
      await advance(5_000); // the scheduled retry carries the edit
      expect(saves.started).toBe(2);
      expect(stored()?.[0].note).toBe("typed while the write was in flight");
      error.mockRestore();
    });

    it("treats a storage layer that throws instead of returning a promise as a failed write", async () => {
      const error = quiet();
      const lib = await fresh();
      saves.throwSync = true;
      lib.add(paper({ id: "a" }));
      await advance(0);
      expect(error).toHaveBeenCalledWith("Could not save the library", expect.any(Error));
      expect(toastSpy).toHaveBeenCalledTimes(1);
      saves.throwSync = false;
      await advance(5_000);
      expect(stored()).toHaveLength(1); // saving did not stop for good
      error.mockRestore();
    });

    it("recovers after an asynchronous failure and writes everything that was added meanwhile", async () => {
      const error = quiet();
      const lib = await fresh();
      saves.fail = true;
      lib.add(paper({ id: "a" }));
      await advance(0);
      saves.fail = false;
      lib.add(paper({ id: "b" }));
      await advance(5_000);
      expect(stored()?.map((e) => e.paper.id)).toEqual(["a", "b"]);
      error.mockRestore();
    });
  });
});

describe("a library file that has to be repaired", () => {
  const backup = () => disk.get("library.json:library.backup");

  it("keeps a copy of the original before the repaired library is written over it", async () => {
    const original = {
      version: 2,
      entries: [
        { paper: paper({ id: "ok" }), addedAt: 1 },
        { paper: paper({ id: "from-a-newer-build" }), addedAt: "2026-10-01T00:00:00Z", note: "the only copy of this note" },
      ],
    };
    disk.set("library.json:library", structuredClone(original));
    const lib = await fresh();
    await settle();
    expect(lib.papers.map((p) => p.id)).toEqual(["ok"]);
    expect(backup()).toEqual(original);
    lib.setNote("ok", "an edit rewrites the file");
    await settle();
    expect(JSON.stringify(disk.get("library.json:library"))).not.toContain("from-a-newer-build");
    expect(backup()).toEqual(original); // …and the copy still has the entry that was dropped
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("(1 item)"), "info");
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("A copy of the original was kept"), "info");
  });

  it("says how many items, in the plural too", async () => {
    disk.set("library.json:library", { version: 2, entries: [{ paper: paper({ id: "ok" }), addedAt: 1 }, "junk", null, { addedAt: 3 }] });
    await fresh();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("(3 items)"), "info");
  });

  it("folds entries that share a paper id into one, keeping what each held, and backs the file up", async () => {
    const original = { version: 2, entries: [
      { paper: paper({ id: "dup" }), addedAt: 1, note: "first", tags: ["a"] },
      { paper: paper({ id: "dup" }), addedAt: 2, note: "second", tags: ["b"], status: "reading", statusAt: 7 },
    ] };
    disk.set("library.json:library", structuredClone(original));
    const lib = await fresh();
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]).toMatchObject({ note: "first\n\n---\n\nsecond", tags: ["a", "b"], status: "reading" });
    await settle();
    expect(backup()).toEqual(original);
  });

  it("writes no backup, and shows nothing, for a clean file, a v1 file, the bare list or no file", async () => {
    for (const clean of [
      { version: 2, entries: [{ paper: paper({ id: "a" }), addedAt: 1 }] },
      { version: 1, entries: [{ paper: paper({ id: "a" }), addedAt: 1 }] },
      [{ paper: paper({ id: "a" }), savedAt: "2026-06-16T10:00:00.000Z" }],
      undefined,
    ]) {
      disk.clear();
      toastSpy.mockClear();
      if (clean !== undefined) disk.set("library.json:library", clean);
      await fresh();
      await settle();
      expect(backup()).toBeUndefined();
      expect(toastSpy).not.toHaveBeenCalled();
    }
  });

  describe("when the copy of the original cannot be made", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      toastSpy.mockClear();
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    const original = () => ({ version: 2, entries: [{ paper: paper({ id: "ok" }), addedAt: 1 }, { paper: paper({ id: "newer" }), addedAt: "2026-10-01T00:00:00Z", note: "only copy" }] });

    it("loads, says plainly that no copy exists, and does not claim one was kept", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      disk.set("library.json:library", original());
      saves.failBackup = true;
      const lib = await fresh();
      expect(lib.papers.map((p) => p.id)).toEqual(["ok"]);
      expect(error).toHaveBeenCalledWith("Could not back up the library file before repairing it", expect.any(Error));
      expect(toastSpy).toHaveBeenCalledTimes(1);
      expect(toastSpy.mock.calls[0][0]).toContain("could not be saved");
      expect(toastSpy.mock.calls[0][0]).not.toContain("was kept");
      error.mockRestore();
    });

    it("never writes the repaired library over the original until a copy exists", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      disk.set("library.json:library", original());
      saves.failBackup = true;
      const lib = await fresh();
      lib.setNote("ok", "an edit");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(JSON.stringify(disk.get("library.json:library"))).toContain("only copy"); // the original is intact
      expect(disk.has("library.json:library.backup")).toBe(false);
      error.mockRestore();
    });

    it("makes the copy first, then saves, as soon as the store works again", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const before = original();
      disk.set("library.json:library", structuredClone(before));
      saves.failBackup = true;
      const lib = await fresh();
      lib.setNote("ok", "an edit");
      await vi.advanceTimersByTimeAsync(0);
      saves.failBackup = false; // the next retry can make the copy
      await vi.advanceTimersByTimeAsync(5_000);
      expect(disk.get("library.json:library.backup")).toEqual(before);
      expect(JSON.stringify(disk.get("library.json:library"))).not.toContain("only copy");
      expect((disk.get("library.json:library") as { entries: { note?: string }[] }).entries[0].note).toBe("an edit");
      expect(toastSpy).toHaveBeenCalledWith("A copy of your original library file was kept.", "info");
      error.mockRestore();
    });

    it("does not hold back saving when there was nothing to repair", async () => {
      disk.set("library.json:library", { version: 2, entries: [{ paper: paper({ id: "ok" }), addedAt: 1 }] });
      saves.failBackup = true; // would matter only if a backup were attempted
      const lib = await fresh();
      lib.setNote("ok", "fine");
      await vi.advanceTimersByTimeAsync(0);
      expect((disk.get("library.json:library") as { entries: { note?: string }[] }).entries[0].note).toBe("fine");
    });
  });

  it.each([
    ["a status from a newer build", { version: 2, entries: [{ paper: paper({ id: "ok" }), addedAt: 1, status: "archived", statusAt: 3 }] }],
    ["more tags than fit", { version: 2, entries: [{ paper: paper({ id: "ok" }), addedAt: 1, tags: Array.from({ length: 40 }, (_, i) => `t${i}`) }] }],
    ["a note that is not text", { version: 2, entries: [{ paper: paper({ id: "ok" }), addedAt: 1, note: { rich: true } }] }],
    ["a shape this build does not know", { version: 3, items: [{ paper: paper({ id: "ok" }), addedAt: 1 }] }],
    ["a file from a newer version", { version: 3, entries: [{ paper: paper({ id: "ok" }), addedAt: 1 }] }],
    ["garbage", "garbage"],
  ])("backs the file up before a read that loses something is written over it: %s", async (_name, raw) => {
    disk.set("library.json:library", structuredClone(raw));
    await fresh();
    await settle();
    expect(disk.get("library.json:library.backup")).toEqual(raw);
    expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining("A copy of the original was kept"), "info");
  });

  it("is not open for writing until the copy of the original has been stored", async () => {
    const original = { version: 2, entries: [{ paper: paper({ id: "ok" }), addedAt: 1 }, "damaged"] };
    disk.set("library.json:library", structuredClone(original));
    let release!: () => void;
    saves.gate = new Promise<void>((resolve) => (release = resolve)); // slow storage: the copy is still being written
    const lib = new LibraryState();
    const loading = lib.ensureLoaded();
    await settle();
    expect(lib.loaded).toBe(false);
    expect(() => lib.setNote("ok", "too early")).toThrow(/still loading/);
    expect(JSON.stringify(disk.get("library.json:library"))).toContain("damaged");
    saves.gate = null;
    release();
    await loading;
    expect(lib.loaded).toBe(true);
    expect(disk.get("library.json:library.backup")).toEqual(original);
  });

  it("does not back up a file that only needed tidying (tag case, a blank note)", async () => {
    disk.set("library.json:library", { version: 2, entries: [{ paper: paper({ id: "ok" }), addedAt: 1, tags: ["NLP", "nlp"], note: "  " }] });
    await fresh();
    await settle();
    expect(disk.has("library.json:library.backup")).toBe(false);
    expect(toastSpy).not.toHaveBeenCalled();
  });
});

describe("two entries with the same title (two different files)", () => {
  const T = "A rather long title that is distinctive enough to match on";
  const twoFiles = async () => {
    const lib = await fresh();
    const first = await lib.addDocument({ ...doc("one.pdf", buf(1, 1)), meta: { title: T, authors: [], year: null, abstract: null, venue: null } });
    const second = await lib.addDocument({ ...doc("two.pdf", buf(2, 2)), meta: { title: T, authors: [], year: null, abstract: null, venue: null } });
    return { lib, first: first.paper, second: second.paper };
  };

  it("each resolves to its own record, so a note or status never lands on the other", async () => {
    const { lib, first, second } = await twoFiles();
    expect(lib.idFor(first)).toBe(first.id);
    expect(lib.idFor(second)).toBe(second.id);
    lib.setNote(lib.idFor(second)!, "belongs to the second file");
    lib.setStatus(lib.idFor(second)!, "reading");
    expect(lib.noteOf(first.id)).toBe("");
    expect(lib.statusOf(first.id)).toBeUndefined();
    expect(lib.noteOf(second.id)).toBe("belongs to the second file");
  });

  it("dropping a removed noted file again brings its note back, even with the other file still there", async () => {
    const { lib, first, second } = await twoFiles();
    lib.setNote(second.id, "note on the second file");
    await lib.remove(second.id);
    expect(lib.orphans.get(second.id)).toBe("note on the second file");
    const again = await lib.addDocument({ ...doc("two.pdf", buf(2, 2)), meta: { title: T, authors: [], year: null, abstract: null, venue: null } });
    expect(again.paper.id).toBe(second.id);
    expect(lib.noteOf(second.id)).toBe("note on the second file");
    expect(lib.orphans.size).toBe(0);
    expect(lib.noteOf(first.id)).toBe("");
  });
});
