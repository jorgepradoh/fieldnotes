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
    return (async () => {
      if (saves.gate) await saves.gate;
      if (saves.fail) throw new Error("disk full");
      disk.set(`${file}:${key}`, structuredClone(value));
      saves.finished++;
    })();
  },
}));
/** Lets a test hold writes open, fail them (asynchronously or by throwing at once), and count them. */
const saves: { started: number; finished: number; gate: Promise<void> | null; fail: boolean; throwSync: boolean } = {
  started: 0,
  finished: 0,
  gate: null,
  fail: false,
  throwSync: false,
};

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

/** Lets every pending write (and the follow-up a burst collapses into) finish. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  disk.clear();
  oldStores.clear();
  Object.assign(saves, { started: 0, finished: 0, gate: null, fail: false, throwSync: false });
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
    expect(lib.byStatus("reading").map((e) => e.paper.id)).toEqual(["b", "a"]);
    expect(lib.byStatus("done")).toEqual([]);
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

  it("removing an entry takes its status, tags and note with it", async () => {
    const lib = await fresh();
    lib.add(paper({ id: "a" }));
    lib.setStatus("a", "done");
    await lib.remove("a");
    expect(lib.byStatus("done")).toEqual([]);
    expect(lib.tags()).toEqual([]);
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
    // The note was keyed by the id the paper had in search, which is the id of the queued copy that merged in.
    expect(lib.hasOrphanNote(paper({ id: "s2:9" }))).toBe(true);
    expect(lib.ensure(paper({ id: "s2:9", doi: "10.1000/x" }))).toBe("bib:1");
    expect(lib.noteOf("bib:1")).toBe("annotated under the search result's id");
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

  it("keeps writing after the storage layer throws instead of returning a promise", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const lib = await fresh();
    saves.throwSync = true;
    lib.add(paper({ id: "a" }));
    await settle();
    expect(error).toHaveBeenCalledWith("Could not save the library", expect.any(Error));
    saves.throwSync = false;
    lib.add(paper({ id: "b" }));
    await settle();
    expect((disk.get("library.json:library") as { entries: unknown[] }).entries).toHaveLength(2);
    error.mockRestore();
  });

  it("keeps writing after a write fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const lib = await fresh();
    saves.fail = true;
    lib.add(paper({ id: "a" }));
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("Could not save the library", expect.any(Error)));
    saves.fail = false;
    lib.add(paper({ id: "b" }));
    await vi.waitFor(() => expect(saves.finished).toBe(1));
    expect((disk.get("library.json:library") as { entries: unknown[] }).entries).toHaveLength(2);
    error.mockRestore();
  });
});
