import { describe, expect, it } from "vitest";
import type { Paper } from "../sources/types";
import { migrateAnnotations, migrateQueue, unusableNotes, unusableQueueItems } from "./migrate";
import type { LibraryData, LibraryEntry } from "./model";

function paper(over: Partial<Paper> & { id: string }): Paper {
  return {
    source: "semantic-scholar",
    title: `Title of paper ${over.id} for the migration tests`,
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

const empty = (): LibraryData => ({ entries: [], orphans: new Map(), migrated: {} });
const withEntries = (...entries: LibraryEntry[]): LibraryData => ({ ...empty(), entries });
const NOW = Date.parse("2026-10-01T00:00:00.000Z");

/** The shape the old queue store wrote: newest first, ISO strings. */
const queueFile = [
  { paper: paper({ id: "s2:newest" }), status: "to-read", addedAt: "2026-09-03T10:00:00.000Z" },
  { paper: paper({ id: "arxiv:1706.03762", arxivId: "1706.03762" }), status: "reading", addedAt: "2026-09-02T10:00:00.000Z" },
  { paper: paper({ id: "oa:W3" }), status: "done", addedAt: "2026-09-01T10:00:00.000Z" },
];

describe("migrateQueue", () => {
  it("adds every queued paper with its status, oldest first", () => {
    const out = migrateQueue(empty(), queueFile, NOW);
    expect(out.entries.map((e) => [e.paper.id, e.status])).toEqual([
      ["oa:W3", "done"],
      ["arxiv:1706.03762", "reading"],
      ["s2:newest", "to-read"],
    ]);
    expect(out.entries.map((e) => e.statusAt)).toEqual([
      Date.parse("2026-09-01T10:00:00.000Z"),
      Date.parse("2026-09-02T10:00:00.000Z"),
      Date.parse("2026-09-03T10:00:00.000Z"),
    ]);
    // A paper new to the library was "added" when it was queued.
    expect(out.entries.map((e) => e.addedAt)).toEqual(out.entries.map((e) => e.statusAt));
    expect(out.migrated).toEqual({ queue: true });
  });

  it("puts the status on the library's own copy when the paper is already saved under another id", () => {
    const saved: LibraryEntry = { paper: paper({ id: "local:1", source: "bibtex", doi: "10.1000/x" }), addedAt: 5, tags: ["keep"], note: "mine" };
    const out = migrateQueue(withEntries(saved), [{ paper: paper({ id: "s2:9", doi: "10.1000/X" }), status: "reading", addedAt: "2026-09-02T10:00:00.000Z" }], NOW);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toMatchObject({ addedAt: 5, status: "reading", tags: ["keep"], note: "mine" });
    expect(out.entries[0].paper.id).toBe("local:1");
  });

  it("makes one record of the same paper queued under two ids", () => {
    const out = migrateQueue(
      empty(),
      [
        { paper: paper({ id: "s2:1", doi: "10.1000/dup" }), status: "to-read", addedAt: "2026-09-01T00:00:00.000Z" },
        { paper: paper({ id: "arxiv:2", doi: "10.1000/dup" }), status: "done", addedAt: "2026-09-02T00:00:00.000Z" },
      ],
      NOW,
    );
    expect(out.entries).toHaveLength(1);
    // The most advanced status wins: the paper was finished, whichever copy said so.
    expect(out.entries[0]).toMatchObject({ status: "done", statusAt: Date.parse("2026-09-02T00:00:00.000Z") });
  });

  it("keeps the most advanced status of merged duplicates whichever copy is older", () => {
    const copies = (olderStatus: string, newerStatus: string) => [
      { paper: paper({ id: "s2:1", doi: "10.1000/dup" }), status: olderStatus, addedAt: "2026-09-01T00:00:00.000Z" },
      { paper: paper({ id: "arxiv:2", doi: "10.1000/dup" }), status: newerStatus, addedAt: "2026-09-02T00:00:00.000Z" },
    ];
    expect(migrateQueue(empty(), copies("to-read", "done"), NOW).entries[0].status).toBe("done");
    expect(migrateQueue(empty(), copies("done", "to-read"), NOW).entries[0].status).toBe("done");
    expect(migrateQueue(empty(), copies("reading", "to-read"), NOW).entries[0].status).toBe("reading");
    expect(migrateQueue(empty(), copies("to-read", "reading"), NOW).entries[0].status).toBe("reading");
  });

  it("never lets a queued duplicate outrank a status the entry already had", () => {
    const existing: LibraryEntry = { paper: paper({ id: "s2:1", doi: "10.1000/dup" }), addedAt: 5, status: "to-read", statusAt: 9 };
    const out = migrateQueue(withEntries(existing), [{ paper: paper({ id: "arxiv:2", doi: "10.1000/dup" }), status: "done", addedAt: "2026-09-02T00:00:00.000Z" }], NOW);
    expect(out.entries[0]).toMatchObject({ status: "to-read", statusAt: 9 });
  });

  it("never replaces a status the entry already has", () => {
    const existing: LibraryEntry = { paper: paper({ id: "s2:1" }), addedAt: 5, status: "done", statusAt: 9 };
    const out = migrateQueue(withEntries(existing), [{ paper: paper({ id: "s2:1" }), status: "to-read", addedAt: "2026-09-01T00:00:00.000Z" }], NOW);
    expect(out.entries[0]).toMatchObject({ status: "done", statusAt: 9 });
  });

  it("skips what is not a queue entry, turns an unknown status into to-read, and tolerates odd times", () => {
    const out = migrateQueue(
      empty(),
      [
        null,
        "junk",
        { status: "reading" },
        { paper: { id: 5 }, status: "reading" },
        { paper: paper({ id: "a" }), status: "banana", addedAt: "not a date" },
        { paper: paper({ id: "b" }), status: "reading", addedAt: 1_700_000_000_000 },
        { paper: paper({ id: "c" }), status: "reading" },
      ],
      NOW,
    );
    expect(out.entries.map((e) => [e.paper.id, e.status])).toEqual([
      ["b", "reading"],
      ["a", "to-read"],
      ["c", "reading"],
    ]);
    expect(out.entries.find((e) => e.paper.id === "a")?.statusAt).toBe(NOW);
    expect(out.entries.find((e) => e.paper.id === "b")?.statusAt).toBe(1_700_000_000_000);
  });

  it("marks an empty queue as imported", () => {
    const out = migrateQueue(empty(), [], NOW);
    expect(out.entries).toEqual([]);
    expect(out.migrated).toEqual({ queue: true });
  });

  it.each([null, undefined, {}, "garbage", 5, { 0: { paper: paper({ id: "a" }) } }])("leaves the data alone, and unflagged, for %j", (raw) => {
    const data = withEntries({ paper: paper({ id: "x" }), addedAt: 1 });
    expect(migrateQueue(data, raw, NOW)).toBe(data);
  });

  it("keeps flags that were already set and does not modify its input", () => {
    const data: LibraryData = { entries: [{ paper: paper({ id: "x" }), addedAt: 1 }], orphans: new Map(), migrated: { annotations: true } };
    const before = structuredClone(data.entries);
    const out = migrateQueue(data, queueFile, NOW);
    expect(out.migrated).toEqual({ annotations: true, queue: true });
    expect(data.entries).toEqual(before);
    expect(data.migrated).toEqual({ annotations: true });
  });

  it("brings along a note that was waiting for a queued paper's id", () => {
    const data: LibraryData = { ...empty(), orphans: new Map([["s2:newest", "annotated before it was queued"]]) };
    const out = migrateQueue(data, queueFile, NOW);
    expect(out.entries.find((e) => e.paper.id === "s2:newest")?.note).toBe("annotated before it was queued");
  });
});

describe("migrateAnnotations", () => {
  it("puts a note on the entry with that id", () => {
    const out = migrateAnnotations(withEntries({ paper: paper({ id: "s2:1" }), addedAt: 1 }), { "s2:1": "# my note\n\ntext" });
    expect(out.entries[0].note).toBe("# my note\n\ntext");
    expect(out.orphans.size).toBe(0);
    expect(out.migrated).toEqual({ annotations: true });
  });

  it("keeps a note whose paper is not in the library as an orphan", () => {
    const out = migrateAnnotations(empty(), { "s2:gone": "still mine" });
    expect([...out.orphans]).toEqual([["s2:gone", "still mine"]]);
  });

  it("joins a note to the one the entry already has instead of replacing it", () => {
    const out = migrateAnnotations(withEntries({ paper: paper({ id: "s2:1" }), addedAt: 1, note: "new build note" }), { "s2:1": "old store note" });
    expect(out.entries[0].note).toBe("new build note\n\n---\n\nold store note");
  });

  it("merges into an orphan already waiting under the same id", () => {
    const data: LibraryData = { ...empty(), orphans: new Map([["s2:x", "first"]]) };
    expect(migrateAnnotations(data, { "s2:x": "second" }).orphans.get("s2:x")).toBe("first\n\n---\n\nsecond");
  });

  it("skips blank and non-string values", () => {
    const out = migrateAnnotations(empty(), { a: "", b: "  \n", c: 5, d: null, e: { x: 1 }, f: "real" });
    expect([...out.orphans.keys()]).toEqual(["f"]);
  });

  it("treats hostile keys as ids, not as properties", () => {
    const raw = JSON.parse('{"__proto__":"p","constructor":"c","toString":"t"}') as unknown;
    const out = migrateAnnotations(empty(), raw);
    expect([...out.orphans.keys()].sort()).toEqual(["__proto__", "constructor", "toString"]);
    expect(({} as Record<string, unknown>).p).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("an entry whose id is __proto__ gets its note like any other", () => {
    const raw = JSON.parse('{"__proto__":"for the odd id"}') as unknown;
    const out = migrateAnnotations(withEntries({ paper: paper({ id: "__proto__" }), addedAt: 1 }), raw);
    expect(out.entries[0].note).toBe("for the odd id");
  });

  it.each([null, undefined, [], ["a"], "garbage", 5])("leaves the data alone, and unflagged, for %j", (raw) => {
    const data = empty();
    expect(migrateAnnotations(data, raw)).toBe(data);
  });

  it("marks an empty store as imported and does not modify its input", () => {
    const data = empty();
    const out = migrateAnnotations(data, {});
    expect(out.migrated).toEqual({ annotations: true });
    expect(data.migrated).toEqual({});
  });
});

describe("both, in the order the store runs them (annotations, then queue)", () => {
  it("a note for a queued paper ends up on its record, and the rest wait", () => {
    const afterNotes = migrateAnnotations(empty(), { "arxiv:1706.03762": "attention!", "s2:never-queued": "orphan" });
    const out = migrateQueue(afterNotes, queueFile, NOW);
    expect(out.entries.find((e) => e.paper.id === "arxiv:1706.03762")).toMatchObject({ status: "reading", note: "attention!" });
    expect([...out.orphans]).toEqual([["s2:never-queued", "orphan"]]);
    expect(out.migrated).toEqual({ queue: true, annotations: true });
  });

  it("a note keyed by an id that merged into another entry is not stranded as an orphan", () => {
    const queue = [
      { paper: paper({ id: "s2:abc", doi: "10.1000/same" }), status: "reading", addedAt: "2026-09-01T00:00:00.000Z" },
      { paper: paper({ id: "arxiv:123", doi: "10.1000/SAME" }), status: "to-read", addedAt: "2026-09-02T00:00:00.000Z" },
    ];
    const out = migrateQueue(migrateAnnotations(empty(), { "arxiv:123": "written when it was known as arxiv:123" }), queue, NOW);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].paper.id).toBe("s2:abc");
    expect(out.entries[0].note).toBe("written when it was known as arxiv:123");
    expect(out.orphans.size).toBe(0);
  });

  it("notes for ids on both sides of a merge are joined, not overwritten", () => {
    const queue = [
      { paper: paper({ id: "s2:abc", doi: "10.1000/same" }), status: "reading", addedAt: "2026-09-01T00:00:00.000Z" },
      { paper: paper({ id: "arxiv:123", doi: "10.1000/same" }), status: "to-read", addedAt: "2026-09-02T00:00:00.000Z" },
    ];
    const out = migrateQueue(migrateAnnotations(empty(), { "s2:abc": "first note", "arxiv:123": "second note" }), queue, NOW);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].note).toBe("first note\n\n---\n\nsecond note");
  });
});

describe("unusableQueueItems", () => {
  it("counts the items of the old queue the import cannot use", () => {
    expect(unusableQueueItems([null, 7, "x", { paper: { id: 1 } }, { status: "reading" }, { paper: paper({ id: "ok" }), status: "reading" }])).toBe(5);
  });

  it("is 0 for a clean queue, an empty one, and anything that is not a list", () => {
    expect(unusableQueueItems(queueFile)).toBe(0);
    expect(unusableQueueItems([])).toBe(0);
    for (const raw of [null, undefined, {}, "x", 5]) expect(unusableQueueItems(raw)).toBe(0);
  });

  it("agrees with what migrateQueue actually imports", () => {
    const raw = [...queueFile, null, { paper: { id: 5 } }];
    expect(migrateQueue(empty(), raw, NOW).entries).toHaveLength(raw.length - unusableQueueItems(raw));
  });
});

describe("unusableNotes", () => {
  it("counts entries of the old annotations store that are not text, but not blank text", () => {
    expect(unusableNotes({ a: "text", b: "", c: "  ", d: { x: 1 }, e: 5, f: ["l"], g: null, h: undefined })).toBe(3);
  });

  it("is 0 for a clean store, and for anything that is not a map", () => {
    expect(unusableNotes({ a: "x" })).toBe(0);
    for (const raw of [null, undefined, [], ["a"], "x", 5]) expect(unusableNotes(raw)).toBe(0);
  });
});
