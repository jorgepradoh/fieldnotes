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
  parseLibraryFile,
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
    expect(parsed.migrated).toEqual({ queue: true });
  });

  it("keeps top-level fields it does not know and drops entries it cannot use", () => {
    const parsed = parseLibraryFile({ version: 2, entries: [{ paper: paper({ id: "a" }), addedAt: 3 }, "junk"], sync: { rev: 9 } });
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.extra).toEqual({ sync: { rev: 9 } });
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

describe("findEntryIndex", () => {
  it("finds a paper by id or by any shared identity, else -1", () => {
    const entries = [entry({ paper: paper({ id: "a", doi: "10.1000/x" }) }), entry({ paper: paper({ id: "b", arxivId: "1706.03762" }) })];
    expect(findEntryIndex(entries, paper({ id: "a" }))).toBe(0);
    expect(findEntryIndex(entries, paper({ id: "zz", doi: "https://doi.org/10.1000/X" }))).toBe(0);
    expect(findEntryIndex(entries, paper({ id: "zz", arxivId: "arXiv:1706.03762v5" }))).toBe(1);
    expect(findEntryIndex(entries, paper({ id: "zz" }))).toBe(-1);
  });
});
