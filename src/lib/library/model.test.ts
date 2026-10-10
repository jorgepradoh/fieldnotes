import { describe, expect, it } from "vitest";
import type { Paper } from "../sources/types";
import {
  MAX_TAGS,
  MAX_TAG_LENGTH,
  addPapers,
  findEntryIndex,
  mergeNotes,
  normalizeTag,
  normalizeTags,
  parseEntry,
  parseEntryChecked,
  parseLibraryFile,
  removeEntry,
  serializeLibrary,
  tagCounts,
  withNote,
  withStatus,
  withTag,
  withoutTag,
  type LibraryData,
  type LibraryEntry,
} from "./model";

function paper(over: Partial<Paper> & { id: string }): Paper {
  return {
    source: "bibtex",
    title: `Title of paper ${over.id} for the model tests`,
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

const entry = (over: Partial<LibraryEntry> & { paper: Paper }): LibraryEntry => ({ addedAt: 1000, ...over });
const empty = (): LibraryData => ({ entries: [], orphans: new Map(), migrated: {} });

describe("normalizeTag", () => {
  it.each([
    ["  Deep   Learning ", "deep learning"],
    ["#NLP", "nlp"],
    ["## nlp", "nlp"],
    ["a,b;c", "a b c"],
    ["tab\tand\nnewline", "tab and newline"],
    ["nul\u0000byte", "nul byte"],
    ["ÉCOLE", "école"],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeTag(raw)).toBe(expected);
  });

  it.each(["", "   ", "#", "# #", ",;,", "\u0000\u0001"])("rejects %j", (raw) => {
    expect(normalizeTag(raw)).toBeNull();
  });

  it("caps the length by characters, not UTF-16 units", () => {
    const long = normalizeTag("x".repeat(100));
    expect(long).toHaveLength(MAX_TAG_LENGTH);
    const emoji = normalizeTag("😀".repeat(100));
    expect(Array.from(emoji ?? "")).toHaveLength(MAX_TAG_LENGTH);
    expect(emoji?.endsWith("\ud83d")).toBe(false); // never a split surrogate pair
  });

  it("is idempotent", () => {
    for (const raw of ["  #Foo, Bar ", "x".repeat(60), "Ünï"]) {
      const once = normalizeTag(raw);
      expect(once && normalizeTag(once)).toBe(once);
    }
  });
});

describe("normalizeTags", () => {
  it("normalises, drops duplicates and junk, and caps the count", () => {
    expect(normalizeTags(["NLP", "nlp", " #nlp ", "vision", 5, null, "", {}])).toEqual(["nlp", "vision"]);
    const many = Array.from({ length: MAX_TAGS + 10 }, (_, i) => `tag${i}`);
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS);
  });

  it("gives [] for anything that is not a list", () => {
    for (const bad of [undefined, null, "nlp", 3, { 0: "nlp" }]) expect(normalizeTags(bad)).toEqual([]);
  });
});

describe("tagCounts", () => {
  it("counts per tag, most used first, ties alphabetical", () => {
    const entries = [
      entry({ paper: paper({ id: "a" }), tags: ["b", "a"] }),
      entry({ paper: paper({ id: "b" }), tags: ["b", "c"] }),
      entry({ paper: paper({ id: "c" }) }),
    ];
    expect(tagCounts(entries)).toEqual([
      { tag: "b", count: 2 },
      { tag: "a", count: 1 },
      { tag: "c", count: 1 },
    ]);
  });
});

describe("parseEntry", () => {
  const p = paper({ id: "a" });

  it("keeps fields it does not know", () => {
    const parsed = parseEntry({ paper: p, addedAt: 5, futureField: { x: 1 }, status: "reading", statusAt: 7 });
    expect(parsed).toMatchObject({ addedAt: 5, status: "reading", statusAt: 7, futureField: { x: 1 } });
  });

  it("drops a status that is not one of the three, with its time", () => {
    const parsed = parseEntry({ paper: p, addedAt: 5, status: "banana", statusAt: 7 });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("statusAt");
  });

  it("drops a status time that is not a finite number but keeps the status", () => {
    for (const bad of ["7", null, Infinity, NaN]) {
      const parsed = parseEntry({ paper: p, addedAt: 5, status: "done", statusAt: bad });
      expect(parsed?.status).toBe("done");
      expect(parsed).not.toHaveProperty("statusAt");
    }
  });

  it("normalises stored tags and drops tags that are not a list", () => {
    expect(parseEntry({ paper: p, addedAt: 5, tags: ["NLP", "nlp", 4] })?.tags).toEqual(["nlp"]);
    expect(parseEntry({ paper: p, addedAt: 5, tags: "nlp" })).not.toHaveProperty("tags");
    expect(parseEntry({ paper: p, addedAt: 5, tags: [] })).not.toHaveProperty("tags");
  });

  it("drops a note that is blank or not a string, keeps real text exactly", () => {
    expect(parseEntry({ paper: p, addedAt: 5, note: "  \n " })).not.toHaveProperty("note");
    expect(parseEntry({ paper: p, addedAt: 5, note: 42 })).not.toHaveProperty("note");
    expect(parseEntry({ paper: p, addedAt: 5, note: "  keep  my spacing\n" })?.note).toBe("  keep  my spacing\n");
  });

  it.each([null, "x", 3, [], {}, { addedAt: 1 }, { paper: {}, addedAt: 1 }, { paper: { id: 5, title: "t", authors: [] }, addedAt: 1 }, { paper: { id: "a", title: "t", authors: "x" }, addedAt: 1 }, { paper: { id: "a", title: "t", authors: [] }, addedAt: "1" }])(
    "rejects %j",
    (bad) => {
      expect(parseEntry(bad)).toBeNull();
    },
  );
});

describe("parseEntryChecked: what counts as losing something", () => {
  const p = paper({ id: "a" });
  const lossy = (extra: Record<string, unknown>) => parseEntryChecked({ paper: p, addedAt: 1, ...extra }).lossy;

  it("is not lossy for a clean entry, unknown fields, or differences that lose nothing", () => {
    expect(lossy({})).toBe(false);
    expect(lossy({ futureField: { x: 1 } })).toBe(false);
    expect(lossy({ status: "reading", statusAt: 4, tags: ["nlp"], note: "text" })).toBe(false);
    expect(lossy({ tags: ["NLP", " #nlp ", "nlp", "Deep  Learning"] })).toBe(false); // case, spacing, '#', duplicates
    expect(lossy({ tags: [] })).toBe(false);
    expect(lossy({ tags: ["ok", "   "] })).toBe(false); // a blank tag was nothing
    expect(lossy({ note: "" })).toBe(false);
    expect(lossy({ note: "  \n " })).toBe(false);
  });

  it("is lossy for a status this build does not know", () => {
    expect(lossy({ status: "archived", statusAt: 3 })).toBe(true);
    expect(parseEntryChecked({ paper: p, addedAt: 1, status: "archived" }).entry).not.toHaveProperty("status");
  });

  it("is lossy for a status time that is not a number", () => {
    expect(lossy({ status: "done", statusAt: "yesterday" })).toBe(true);
    expect(lossy({ status: "done", statusAt: Infinity })).toBe(true);
  });

  it("is lossy for tags that are not a list of strings, are cut short, or do not all fit", () => {
    expect(lossy({ tags: "nlp" })).toBe(true);
    expect(lossy({ tags: ["a", 5] })).toBe(true);
    expect(lossy({ tags: ["a", { name: "b" }] })).toBe(true);
    expect(lossy({ tags: ["x".repeat(MAX_TAG_LENGTH + 1)] })).toBe(true);
    expect(lossy({ tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`) })).toBe(true);
    expect(lossy({ tags: Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`) })).toBe(false);
    expect(lossy({ tags: ["x".repeat(MAX_TAG_LENGTH)] })).toBe(false);
  });

  it("is lossy for a note that is not text", () => {
    expect(lossy({ note: { text: "rich" } })).toBe(true);
    expect(lossy({ note: 42 })).toBe(true);
  });

  it("is not lossy-but-usable for an entry that cannot be used at all: that is null", () => {
    expect(parseEntryChecked({ addedAt: "1" })).toEqual({ entry: null, lossy: false });
  });
});

describe("parseLibraryFile", () => {
  it("reads the first desktop build's bare list of { paper, savedAt }", () => {
    const parsed = parseLibraryFile([
      { paper: paper({ id: "old-a" }), savedAt: "2026-06-16T10:00:00.000Z" },
      { paper: paper({ id: "old-b" }), savedAt: "not a date" },
      { nope: true },
      null,
    ]);
    expect(parsed.entries.map((e) => e.paper.id)).toEqual(["old-a", "old-b"]);
    expect(parsed.entries[0].addedAt).toBe(Date.parse("2026-06-16T10:00:00.000Z"));
    expect(Number.isFinite(parsed.entries[1].addedAt)).toBe(true);
    expect(parsed.migrated).toEqual({});
  });

  it("reads v1, which has no status, tags or notes", () => {
    const parsed = parseLibraryFile({ version: 1, entries: [{ paper: paper({ id: "a" }), addedAt: 3 }] });
    expect(parsed.entries).toEqual([{ paper: paper({ id: "a" }), addedAt: 3 }]);
    expect(parsed.orphans.size).toBe(0);
  });

  it("reads v2 with orphan notes and migration flags", () => {
    const parsed = parseLibraryFile({
      version: 2,
      entries: [{ paper: paper({ id: "a" }), addedAt: 3, status: "reading", statusAt: 4, tags: ["x"], note: "n" }],
      orphanNotes: { "s2:gone": "a note", blank: "  ", number: 7 },
      migrated: { queue: true, annotations: "yes", other: true },
    });
    expect(parsed.entries[0]).toMatchObject({ status: "reading", tags: ["x"], note: "n" });
    expect([...parsed.orphans]).toEqual([["s2:gone", "a note"]]);
    // Only an exact `true` counts for a flag this build owns; flags it does not know are kept.
    expect(parsed.migrated).toEqual({ queue: true, other: true });
  });

  it("keeps top-level fields it does not know and drops entries it cannot use", () => {
    const parsed = parseLibraryFile({ version: 2, entries: [{ paper: paper({ id: "a" }), addedAt: 3 }, "junk"], sync: { rev: 9 } });
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.extra).toEqual({ sync: { rev: 9 } });
  });

  describe("repairs what it cannot read as it is, and says how much", () => {
    it("counts entries that were dropped", () => {
      const parsed = parseLibraryFile({ version: 2, entries: [{ paper: paper({ id: "ok" }), addedAt: 1 }, { paper: paper({ id: "newer" }), addedAt: "2026-10-01T00:00:00Z" }, "junk", null] });
      expect(parsed.entries.map((e) => e.paper.id)).toEqual(["ok"]);
      expect(parsed.repaired).toBe(3);
    });

    it("counts an entry that was readable only by dropping or cutting a field", () => {
      const parsed = parseLibraryFile({ version: 2, entries: [
        { paper: paper({ id: "a" }), addedAt: 1, status: "archived", note: "kept" },
        { paper: paper({ id: "b" }), addedAt: 2, tags: Array.from({ length: 40 }, (_, i) => `t${i}`) },
        { paper: paper({ id: "c" }), addedAt: 3, note: { text: "rich" } },
        { paper: paper({ id: "d" }), addedAt: 4, tags: ["NLP"] }, // nothing lost
      ] });
      expect(parsed.entries.map((e) => e.paper.id)).toEqual(["a", "b", "c", "d"]);
      expect(parsed.repaired).toBe(3);
    });

    it.each([
      ["a string", "garbage"],
      ["a number", 7],
      ["an empty object", {}],
      ["entries that is not a list", { version: 2, entries: { a: 1 } }],
      ["a shape from a newer build", { version: 3, items: [{ paper: paper({ id: "x" }), addedAt: 1 }] }],
    ])("counts a file whose shape it does not know (%s), since the next write would replace it", (_name, raw) => {
      const parsed = parseLibraryFile(raw);
      expect(parsed.entries).toEqual([]);
      expect(parsed.repaired).toBe(1);
    });

    it("counts a file written by a newer version even when its entries are readable", () => {
      const parsed = parseLibraryFile({ version: 3, entries: [{ paper: paper({ id: "a" }), addedAt: 1 }] });
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.repaired).toBe(1);
    });

    it("keeps the file a stored file of an entry it folds a duplicate into", () => {
      const file = { id: "blob1", name: "x.pdf", kind: "pdf" as const, size: 3 };
      const parsed = parseLibraryFile({ version: 2, entries: [
        { paper: paper({ id: "d" }), addedAt: 1 },
        { paper: paper({ id: "d", localFile: file }), addedAt: 2 },
      ] });
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0].paper.localFile).toEqual(file);
    });

    it("does not replace the first entry's own file with a duplicate's", () => {
      const parsed = parseLibraryFile({ version: 2, entries: [
        { paper: paper({ id: "d", localFile: { id: "first", name: "1.pdf", kind: "pdf", size: 1 } }), addedAt: 1 },
        { paper: paper({ id: "d", localFile: { id: "second", name: "2.pdf", kind: "pdf", size: 2 } }), addedAt: 2 },
      ] });
      expect(parsed.entries[0].paper.localFile?.id).toBe("first");
    });

    it("reports nothing for a clean file, a v1 file or an empty one", () => {
      expect(parseLibraryFile({ version: 2, entries: [{ paper: paper({ id: "a" }), addedAt: 1 }] }).repaired).toBe(0);
      expect(parseLibraryFile({ version: 1, entries: [] }).repaired).toBe(0);
      expect(parseLibraryFile(null).repaired).toBe(0);
    });

    it("counts unusable items in the first build's bare list too", () => {
      const parsed = parseLibraryFile([{ paper: paper({ id: "a" }), savedAt: "2026-06-16T10:00:00.000Z" }, { nope: true }, null]);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.repaired).toBe(2);
    });

    it("folds entries sharing a paper id into the first, losing neither note, tag nor status", () => {
      const parsed = parseLibraryFile({
        version: 2,
        entries: [
          { paper: paper({ id: "dup", title: "First copy of this paper, long enough" }), addedAt: 1, note: "first note", tags: ["a"] },
          { paper: paper({ id: "other" }), addedAt: 2 },
          { paper: paper({ id: "dup", title: "Second copy of this paper, long enough" }), addedAt: 3, note: "second note", tags: ["b", "a"], status: "done", statusAt: 9 },
        ],
      });
      expect(parsed.entries.map((e) => e.paper.id)).toEqual(["dup", "other"]);
      expect(parsed.entries[0]).toMatchObject({ addedAt: 1, note: "first note\n\n---\n\nsecond note", tags: ["a", "b"], status: "done", statusAt: 9 });
      expect(parsed.entries[0].paper.title).toBe("First copy of this paper, long enough");
      expect(parsed.repaired).toBe(1);
    });

    it("keeps the first entry's status when both have one", () => {
      const parsed = parseLibraryFile({ version: 2, entries: [
        { paper: paper({ id: "d" }), addedAt: 1, status: "reading", statusAt: 5 },
        { paper: paper({ id: "d" }), addedAt: 2, status: "done", statusAt: 9 },
      ] });
      expect(parsed.entries[0]).toMatchObject({ status: "reading", statusAt: 5 });
    });

    it("folds duplicates in the bare list as well", () => {
      const parsed = parseLibraryFile([{ paper: paper({ id: "d" }), savedAt: "2026-06-16T10:00:00.000Z" }, { paper: paper({ id: "d" }), savedAt: "2026-06-17T10:00:00.000Z" }]);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.repaired).toBe(1);
    });
  });

  it.each([null, undefined, "garbage", 7, {}, { entries: "no" }, { version: 2 }])("treats %j as an empty library", (raw) => {
    const parsed = parseLibraryFile(raw);
    expect(parsed.entries).toEqual([]);
    expect(parsed.orphans.size).toBe(0);
  });

  it("stores a hostile orphan key as data and never touches the prototype", () => {
    const text = '{"version":2,"entries":[],"orphanNotes":{"__proto__":"polluted","constructor":"c"}}';
    const parsed = parseLibraryFile(JSON.parse(text));
    expect(parsed.orphans.get("__proto__")).toBe("polluted");
    expect(parsed.orphans.get("constructor")).toBe("c");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    // …and survives a write/read cycle as data too.
    const again = parseLibraryFile(JSON.parse(JSON.stringify(serializeLibrary(parsed))));
    expect(again.orphans.get("__proto__")).toBe("polluted");
    expect(Object.getPrototypeOf(JSON.parse(JSON.stringify(serializeLibrary(parsed))).orphanNotes)).toBe(Object.prototype);
  });
});

describe("serializeLibrary", () => {
  it("writes version 2 and omits what is empty", () => {
    expect(serializeLibrary(empty())).toEqual({ version: 2, entries: [] });
  });

  it("writes orphan notes and migration flags when present", () => {
    const data: LibraryData = { entries: [], orphans: new Map([["s2:x", "n"]]), migrated: { queue: true, annotations: true } };
    expect(serializeLibrary(data)).toEqual({ version: 2, entries: [], orphanNotes: { "s2:x": "n" }, migrated: { queue: true, annotations: true } });
  });

  it("carries unknown top-level fields through but never lets them override the ones it owns", () => {
    const out = serializeLibrary(empty(), { sync: { rev: 9 }, version: 99, entries: "evil" });
    expect(out).toEqual({ sync: { rev: 9 }, version: 2, entries: [] });
  });

  it("keeps migration flags it does not know through a load and write", () => {
    const parsed = parseLibraryFile({ version: 2, entries: [], migrated: { queue: true, annotations: true, tags2: true } });
    expect(serializeLibrary(parsed).migrated).toEqual({ queue: true, annotations: true, tags2: true });
  });

  it("writes `migrated` for a flag only this build does not know, and not at all when there are none", () => {
    expect(serializeLibrary({ ...empty(), migrated: { future: true } }).migrated).toEqual({ future: true });
    expect(serializeLibrary(empty())).not.toHaveProperty("migrated");
  });

  it("round-trips an entry with unknown fields unchanged", () => {
    const e = { ...entry({ paper: paper({ id: "a" }), status: "done", statusAt: 9, tags: ["x"], note: "n" }), future: [1, 2] };
    const parsed = parseLibraryFile(JSON.parse(JSON.stringify(serializeLibrary({ ...empty(), entries: [e] }))));
    expect(parsed.entries).toEqual([e]);
  });
});

describe("entry operations", () => {
  const base = entry({ paper: paper({ id: "a" }) });

  it("withStatus sets, clears, and returns the same object when nothing changes", () => {
    const reading = withStatus(base, "reading", 50);
    expect(reading).toMatchObject({ status: "reading", statusAt: 50 });
    expect(withStatus(reading, "reading", 99)).toBe(reading); // not a move: the time stays
    expect(withStatus(reading, "done", 99)).toMatchObject({ status: "done", statusAt: 99 });
    const cleared = withStatus(reading, null, 99);
    expect(cleared).not.toHaveProperty("status");
    expect(cleared).not.toHaveProperty("statusAt");
    expect(withStatus(base, null, 1)).toBe(base);
  });

  it("withNote sets, clears on blank, and returns the same object when unchanged", () => {
    const noted = withNote(base, "hello");
    expect(noted.note).toBe("hello");
    expect(withNote(noted, "hello")).toBe(noted);
    expect(withNote(noted, " \n ")).not.toHaveProperty("note");
    expect(withNote(base, "")).toBe(base);
  });

  it("withTag adds normalised tags and says why it did not", () => {
    const one = withTag(base, "  #NLP ");
    expect(one).toMatchObject({ result: "added", entry: { tags: ["nlp"] } });
    expect(withTag(one.entry, "nlp")).toEqual({ entry: one.entry, result: "exists" });
    expect(withTag(base, " , ")).toEqual({ entry: base, result: "invalid" });
    const full = entry({ paper: paper({ id: "f" }), tags: Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`) });
    expect(withTag(full, "one more")).toEqual({ entry: full, result: "full" });
    expect(withTag(full, "t3").result).toBe("exists");
  });

  it("withoutTag removes, drops the field when empty, and ignores unknown tags", () => {
    const tagged = entry({ paper: paper({ id: "t" }), tags: ["a", "b"] });
    expect(withoutTag(tagged, " B ").tags).toEqual(["a"]);
    expect(withoutTag(withoutTag(tagged, "a"), "b")).not.toHaveProperty("tags");
    expect(withoutTag(tagged, "zzz")).toBe(tagged);
    expect(withoutTag(base, "a")).toBe(base);
  });

  it("do not modify the entry they were given", () => {
    const frozen = Object.freeze({ ...base, tags: Object.freeze(["a"]) as string[] }) as LibraryEntry;
    expect(() => {
      withStatus(frozen, "done", 1);
      withNote(frozen, "x");
      withTag(frozen, "b");
      withoutTag(frozen, "a");
    }).not.toThrow();
  });
});

describe("mergeNotes", () => {
  it("takes the incoming text when there is nothing yet", () => {
    expect(mergeNotes(undefined, "new")).toBe("new");
    expect(mergeNotes("  \n", "new")).toBe("new");
  });

  it("keeps one copy of identical text", () => {
    expect(mergeNotes("same", "same")).toBe("same");
    expect(mergeNotes("same\n", " same")).toBe("same\n");
  });

  it("joins different notes and never drops either, even when one is a fragment of the other", () => {
    expect(mergeNotes("first", "second")).toBe("first\n\n---\n\nsecond");
    // "a" is inside "a long note", but it is still a separate note the user wrote.
    expect(mergeNotes("a long note", "a")).toBe("a long note\n\n---\n\na");
  });
});

describe("addPapers", () => {
  it("adds new papers, stamps them, and reports their record ids", () => {
    const out = addPapers(empty(), [paper({ id: "a" }), paper({ id: "b" })], 77);
    expect(out.added.map((p) => p.id)).toEqual(["a", "b"]);
    expect(out.merged).toBe(0);
    expect(out.ids).toEqual(["a", "b"]);
    expect(out.data.entries.map((e) => e.addedAt)).toEqual([77, 77]);
  });

  it("takes a time per paper when given a list", () => {
    const out = addPapers(empty(), [paper({ id: "a" }), paper({ id: "b" })], [10, 20]);
    expect(out.data.entries.map((e) => e.addedAt)).toEqual([10, 20]);
  });

  it("merges a paper into the entry it matches and reports that entry's id, keeping its state", () => {
    const saved = entry({ paper: paper({ id: "arxiv:1", doi: "10.1000/x" }), status: "reading", statusAt: 5, tags: ["t"], note: "mine" });
    const out = addPapers({ ...empty(), entries: [saved] }, [paper({ id: "s2:9", doi: "10.1000/X", abstract: "now with an abstract" })], 1);
    expect(out.merged).toBe(1);
    expect(out.added).toEqual([]);
    expect(out.ids).toEqual(["arxiv:1"]);
    expect(out.data.entries).toHaveLength(1);
    expect(out.data.entries[0]).toMatchObject({ status: "reading", statusAt: 5, tags: ["t"], note: "mine" });
    expect(out.data.entries[0].paper).toMatchObject({ id: "arxiv:1", abstract: "now with an abstract" });
  });

  it("de-duplicates within one batch", () => {
    const out = addPapers(empty(), [paper({ id: "a", doi: "10.1000/x" }), paper({ id: "b", doi: "10.1000/x" })], 1);
    expect(out.ids).toEqual(["a", "a"]);
    expect(out.data.entries).toHaveLength(1);
  });

  it("gives a new entry the note that was waiting under its id", () => {
    const data: LibraryData = { ...empty(), orphans: new Map([["s2:abc", "old note"], ["s2:other", "stays"]]) };
    const out = addPapers(data, [paper({ id: "s2:abc" })], 1);
    expect(out.data.entries[0].note).toBe("old note");
    expect([...out.data.orphans]).toEqual([["s2:other", "stays"]]);
  });

  it("gives an entry it merged into the note waiting under the *incoming* id", () => {
    const saved = entry({ paper: paper({ id: "arxiv:1", doi: "10.1000/x" }), note: "existing" });
    const data: LibraryData = { entries: [saved], orphans: new Map([["s2:9", "from the old store"]]), migrated: {} };
    const out = addPapers(data, [paper({ id: "s2:9", doi: "10.1000/x" })], 1);
    expect(out.data.entries[0].note).toBe("existing\n\n---\n\nfrom the old store");
    expect(out.data.orphans.size).toBe(0);
  });

  it("merges into the same entry findEntryIndex resolves to when two entries share a title", () => {
    const T = "A rather long title that is distinctive enough to match on";
    const entries = [entry({ paper: paper({ id: "file-one", title: T }) }), entry({ paper: paper({ id: "file-two", title: T }) })];
    const probe = paper({ id: "s2:search", title: T, abstract: "from search" });
    expect(entries[findEntryIndex(entries, probe)].paper.id).toBe("file-one");
    const out = addPapers({ ...empty(), entries }, [probe], 9);
    expect(out.ids).toEqual(["file-one"]);
    expect(out.data.entries[0].paper.abstract).toBe("from search");
    expect(out.data.entries[1].paper.abstract).toBeNull();
  });

  it("an exact id match is the record, even when an earlier entry shares the title", () => {
    const T = "A rather long title that is distinctive enough to match on";
    const entries = [entry({ paper: paper({ id: "file-one", title: T }) }), entry({ paper: paper({ id: "file-two", title: T }) })];
    const probe = paper({ id: "file-two", title: T });
    expect(findEntryIndex(entries, probe)).toBe(1);
    const out = addPapers({ ...empty(), entries }, [probe], 9);
    expect(out.ids).toEqual(["file-two"]);
    expect(out.merged).toBe(1);
  });

  it("does not modify the data it was given", () => {
    const saved = entry({ paper: paper({ id: "a", doi: "10.1000/x" }) });
    const data: LibraryData = { entries: [saved], orphans: new Map([["b", "n"]]), migrated: {} };
    addPapers(data, [paper({ id: "a", abstract: "x" }), paper({ id: "b" })], 1);
    expect(data.entries).toEqual([saved]);
    expect(data.entries[0].paper.abstract).toBeNull();
    expect([...data.orphans]).toEqual([["b", "n"]]);
  });
});

describe("findEntryIndex and the identity keys it remembers", () => {
  it("sees a new identity after a merge replaces the entry's paper", () => {
    const before = [entry({ paper: paper({ id: "a", title: "short" }) })];
    const probe = paper({ id: "zz", doi: "10.1000/arrives-later" });
    expect(findEntryIndex(before, probe)).toBe(-1); // fills the cache for this entry
    const merged = addPapers({ ...empty(), entries: before }, [paper({ id: "a", title: "short", doi: "10.1000/arrives-later" })], 1);
    expect(merged.data.entries[0].paper.doi).toBe("10.1000/arrives-later");
    expect(findEntryIndex(merged.data.entries, probe)).toBe(0);
  });

  it("still finds the same entry on repeated asks", () => {
    const entries = [entry({ paper: paper({ id: "a", doi: "10.1000/x" }) })];
    for (let i = 0; i < 3; i++) expect(findEntryIndex(entries, paper({ id: "zz", doi: "10.1000/x" }))).toBe(0);
  });
});

describe("findEntryIndex: same-title entries keep their own identity", () => {
  const T = "A rather long title that is distinctive enough to match on";
  const entries = [entry({ paper: paper({ id: "local:A", title: T }) }), entry({ paper: paper({ id: "local:B", title: T }) })];

  it("each entry resolves to itself", () => {
    expect(findEntryIndex(entries, entries[0].paper)).toBe(0);
    expect(findEntryIndex(entries, entries[1].paper)).toBe(1);
  });

  it("a paper with another id and the same title resolves to the first", () => {
    expect(findEntryIndex(entries, paper({ id: "s2:x", title: T }))).toBe(0);
  });
});

describe("findEntryIndex", () => {
  it("finds a paper by id or by any shared identity, else -1", () => {
    const entries = [entry({ paper: paper({ id: "a", doi: "10.1000/x" }) }), entry({ paper: paper({ id: "b", arxivId: "1706.03762" }) })];
    expect(findEntryIndex(entries, paper({ id: "a" }))).toBe(0);
    expect(findEntryIndex(entries, paper({ id: "zz", doi: "https://doi.org/10.1000/X" }))).toBe(0);
    expect(findEntryIndex(entries, paper({ id: "zz", arxivId: "arXiv:1706.03762v5" }))).toBe(1);
    expect(findEntryIndex(entries, paper({ id: "zz" }))).toBe(-1);
  });
});

describe("removeEntry", () => {
  const withNoteAndState = entry({ paper: paper({ id: "a" }), status: "reading", statusAt: 3, tags: ["t"], note: "my note" });

  it("removes the entry, with its status and tags, but keeps the note waiting under its id", () => {
    const out = removeEntry({ ...empty(), entries: [withNoteAndState, entry({ paper: paper({ id: "b" }) })] }, "a");
    expect(out.entries.map((e) => e.paper.id)).toEqual(["b"]);
    expect([...out.orphans]).toEqual([["a", "my note"]]);
  });

  it("brings the note back when the same paper is added again", () => {
    const removed = removeEntry({ ...empty(), entries: [withNoteAndState] }, "a");
    const again = addPapers(removed, [paper({ id: "a" })], 5);
    expect(again.data.entries[0]).toMatchObject({ note: "my note" });
    expect(again.data.entries[0]).not.toHaveProperty("status");
    expect(again.data.orphans.size).toBe(0);
  });

  it("leaves no orphan for an entry without a note, and joins with one already waiting", () => {
    expect(removeEntry({ ...empty(), entries: [entry({ paper: paper({ id: "a" }) })] }, "a").orphans.size).toBe(0);
    const out = removeEntry({ ...empty(), entries: [withNoteAndState], orphans: new Map([["a", "older"]]) }, "a");
    expect(out.orphans.get("a")).toBe("older\n\n---\n\nmy note");
  });

  it("returns the same data for an id that is not there, and does not modify its input", () => {
    const data = { ...empty(), entries: [withNoteAndState] };
    expect(removeEntry(data, "nope")).toBe(data);
    removeEntry(data, "a");
    expect(data.entries).toHaveLength(1);
    expect(data.orphans.size).toBe(0);
  });
});
