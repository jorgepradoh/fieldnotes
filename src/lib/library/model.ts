/**
 * The shape of library.json (v2) and the pure operations on it. The library
 * entry is the one record for a paper: reading status, tags and notes hang off
 * it, so the same paper reached from any source shows the same state. The
 * reactive store in core/library.svelte.ts is a thin shell around this file.
 *
 * Loading accepts every format the library has had (the June build's bare
 * list, v1, v2) and keeps fields it does not know, so a newer build's data
 * survives a round trip through this one.
 */
import { mergePapers, paperKeys } from "../sources/merge";
import type { Paper } from "../sources/types";

export type PaperStatus = "to-read" | "reading" | "done";
export const STATUSES: readonly PaperStatus[] = ["to-read", "reading", "done"];

export interface LibraryEntry {
  paper: Paper;
  addedAt: number;
  /** Where the paper is in the reading queue; absent when it is not queued. */
  status?: PaperStatus;
  statusAt?: number;
  /** Trimmed, lower-case, unique (see normalizeTag). */
  tags?: string[];
  /** Markdown. */
  note?: string;
}

/** Which one-time imports of the old stores have already run. Flags this build does not know are kept. */
export interface Migrated {
  queue?: true;
  annotations?: true;
  [other: string]: unknown;
}

/** Everything in library.json that this build understands. */
export interface LibraryData {
  entries: LibraryEntry[];
  /** Notes written for an id that no entry has (yet); adopted when a paper with that id arrives. */
  orphans: Map<string, string>;
  migrated: Migrated;
}

export interface ParsedLibrary extends LibraryData {
  /** Top-level fields this build does not know; written back untouched. */
  extra: Record<string, unknown>;
  /** Entries that could not be read as they were (dropped, or merged into another with the same id). */
  repaired: number;
}

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 30;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStatus(value: unknown): value is PaperStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/** The minimum a stored paper must have for the rest of the app not to trip over it. */
export function isPaperLike(value: unknown): value is Paper {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string" && Array.isArray(value.authors);
}

// ------------------------------------------------------------------- tags

/**
 * One tag as it is stored: lower-case, single spaces, no leading "#", no commas
 * or semicolons (they separate tags in the UI and in BibTeX `keywords`), no
 * control characters, at most MAX_TAG_LENGTH characters. Null when nothing is left.
 */
export function normalizeTag(raw: string): string | null {
  const cleaned = raw
    .replace(/[\p{Cc},;]+/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[#\s]+/, "")
    .trim()
    .toLowerCase();
  const tag = Array.from(cleaned).slice(0, MAX_TAG_LENGTH).join("").trim();
  return tag === "" ? null : tag;
}

/** Normalised, de-duplicated and capped; anything that is not a list of strings gives []. */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tags: string[] = [];
  for (const item of raw) {
    const tag = typeof item === "string" ? normalizeTag(item) : null;
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

export function tagCounts(entries: readonly LibraryEntry[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) for (const tag of entry.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// ------------------------------------------------------------------ parsing

/**
 * One stored entry, or null when it is not usable. Unknown fields are kept; known
 * ones that are invalid (a status that is not one of the three, tags that are not
 * strings) are dropped rather than trusted.
 */
export function parseEntry(value: unknown): LibraryEntry | null {
  if (!isRecord(value) || typeof value.addedAt !== "number" || !isPaperLike(value.paper)) return null;
  const entry = { ...value } as unknown as LibraryEntry;
  if (!isStatus(entry.status)) {
    delete entry.status;
    delete entry.statusAt;
  } else if (typeof entry.statusAt !== "number" || !Number.isFinite(entry.statusAt)) {
    delete entry.statusAt;
  }
  const tags = normalizeTags(value.tags);
  if (tags.length > 0) entry.tags = tags;
  else delete entry.tags;
  if (typeof entry.note !== "string" || entry.note.trim() === "") delete entry.note;
  return entry;
}

/** The first desktop build kept a bare list of { paper, savedAt } under the same key. */
function fromLegacyList(list: unknown[]): (LibraryEntry | null)[] {
  return list.map((item) => {
    if (!isRecord(item) || !isPaperLike(item.paper)) return null;
    const at = typeof item.savedAt === "string" ? Date.parse(item.savedAt) : NaN;
    return { paper: item.paper, addedAt: Number.isNaN(at) ? Date.now() : at };
  });
}

/**
 * Drops what failed to parse and folds entries that share a paper id into the first (the views key
 * on the id, and every update addresses the first). Nothing the duplicates held is lost: notes are
 * joined, tags are united, and a status is taken from the first entry that has one.
 */
function settleEntries(candidates: readonly (LibraryEntry | null)[]): { entries: LibraryEntry[]; repaired: number } {
  const entries: LibraryEntry[] = [];
  const at = new Map<string, number>();
  let repaired = 0;
  for (const candidate of candidates) {
    if (candidate === null) {
      repaired++;
      continue;
    }
    const first = at.get(candidate.paper.id);
    if (first === undefined) {
      at.set(candidate.paper.id, entries.length);
      entries.push(candidate);
      continue;
    }
    repaired++;
    let merged = entries[first];
    if (candidate.note !== undefined) merged = withNote(merged, mergeNotes(merged.note, candidate.note));
    const tags = normalizeTags([...(merged.tags ?? []), ...(candidate.tags ?? [])]);
    if (tags.length > 0) merged = { ...merged, tags };
    if (merged.status === undefined && candidate.status !== undefined) {
      merged = { ...merged, status: candidate.status, statusAt: candidate.statusAt ?? candidate.addedAt };
    }
    entries[first] = merged;
  }
  return { entries, repaired };
}

function parseOrphans(raw: unknown): Map<string, string> {
  const orphans = new Map<string, string>();
  // Object.entries lists an own "__proto__" key as data; a Map stores it as data too.
  if (isRecord(raw)) for (const [id, text] of Object.entries(raw)) if (typeof text === "string" && text.trim() !== "") orphans.set(id, text);
  return orphans;
}

const KNOWN_FILE_KEYS = new Set(["version", "entries", "orphanNotes", "migrated"]);

/** Reads the bare list, v1 and v2 alike; anything else is an empty library. */
export function parseLibraryFile(raw: unknown): ParsedLibrary {
  if (Array.isArray(raw)) return { ...settleEntries(fromLegacyList(raw)), orphans: new Map(), migrated: {}, extra: {} };
  if (!isRecord(raw) || !Array.isArray(raw.entries)) return { entries: [], orphans: new Map(), migrated: {}, extra: {}, repaired: 0 };

  const { entries, repaired } = settleEntries(raw.entries.map(parseEntry));
  const migrated: Migrated = isRecord(raw.migrated) ? { ...raw.migrated } : {};
  // A flag only counts when it is exactly `true`; anything else means that import has not run.
  if (migrated.queue !== true) delete migrated.queue;
  if (migrated.annotations !== true) delete migrated.annotations;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) if (!KNOWN_FILE_KEYS.has(key)) extra[key] = value;
  return { entries, orphans: parseOrphans(raw.orphanNotes), migrated, extra, repaired };
}

/** What gets written: unknown top-level fields first so the ones we own always win. */
export function serializeLibrary(data: LibraryData, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const file: Record<string, unknown> = { ...extra, version: 2, entries: data.entries };
  if (data.orphans.size > 0) file.orphanNotes = Object.fromEntries(data.orphans);
  if (Object.keys(data.migrated).length > 0) file.migrated = { ...data.migrated };
  return file;
}

// ------------------------------------------------------------------- entries

/** Joins two notes about one paper; the same text twice stays once, and neither is ever lost. */
export function mergeNotes(existing: string | undefined, incoming: string): string {
  if (existing === undefined || existing.trim() === "") return incoming;
  if (existing.trim() === incoming.trim()) return existing;
  return `${existing}\n\n---\n\n${incoming}`;
}

/** The same entry object when nothing changes, so callers can skip a write. */
export function withStatus(entry: LibraryEntry, status: PaperStatus | null, now: number): LibraryEntry {
  if (status === null) {
    if (entry.status === undefined && entry.statusAt === undefined) return entry;
    const next = { ...entry };
    delete next.status;
    delete next.statusAt;
    return next;
  }
  return entry.status === status ? entry : { ...entry, status, statusAt: now };
}

export function withNote(entry: LibraryEntry, text: string): LibraryEntry {
  const note = text.trim() === "" ? undefined : text;
  if (entry.note === note) return entry;
  const next = { ...entry };
  if (note === undefined) delete next.note;
  else next.note = note;
  return next;
}

export type TagResult = "added" | "exists" | "invalid" | "full";

export function withTag(entry: LibraryEntry, raw: string): { entry: LibraryEntry; result: TagResult } {
  const tag = normalizeTag(raw);
  if (tag === null) return { entry, result: "invalid" };
  const tags = entry.tags ?? [];
  if (tags.includes(tag)) return { entry, result: "exists" };
  if (tags.length >= MAX_TAGS) return { entry, result: "full" };
  return { entry: { ...entry, tags: [...tags, tag] }, result: "added" };
}

export function withoutTag(entry: LibraryEntry, raw: string): LibraryEntry {
  const tag = normalizeTag(raw);
  if (tag === null || !entry.tags?.includes(tag)) return entry;
  const next = { ...entry };
  const tags = entry.tags.filter((t) => t !== tag);
  if (tags.length > 0) next.tags = tags;
  else delete next.tags;
  return next;
}

// ------------------------------------------------------------ adding papers

/** Enrich `existing` with whatever `incoming` knows, keeping the library's own id and file. */
function enrich(existing: Paper, incoming: Paper): Paper {
  const merged = mergePapers(existing, incoming);
  delete merged.sources;
  return { ...merged, id: existing.id, source: existing.source, localFile: existing.localFile ?? incoming.localFile };
}

// An entry's paper is replaced, never edited in place, so its identity keys can be remembered per
// object: every module that asks "is this paper saved?" re-asks on each library change.
const entryKeys = new WeakMap<Paper, string[]>();

function keysOfEntryPaper(paper: Paper): string[] {
  let keys = entryKeys.get(paper);
  if (!keys) {
    keys = paperKeys(paper);
    entryKeys.set(paper, keys);
  }
  return keys;
}

/**
 * Index of the entry holding this paper, or -1. An entry with the same id is always the one (two
 * entries can share a title on purpose, say two different files, and each must resolve to itself);
 * otherwise the first entry sharing an identity key (DOI, arXiv id, title).
 */
export function findEntryIndex(entries: readonly LibraryEntry[], paper: Paper): number {
  const sameId = entries.findIndex((e) => e.paper.id === paper.id);
  if (sameId >= 0) return sameId;
  const keys = new Set(paperKeys(paper));
  return entries.findIndex((e) => keysOfEntryPaper(e.paper).some((k) => keys.has(k)));
}

/** Moves a note waiting under `key` onto the entry at `at`. Mutates its arguments (callers hold copies). */
export function adoptOrphan(entries: LibraryEntry[], orphans: Map<string, string>, key: string, at: number): void {
  const text = orphans.get(key);
  if (text === undefined) return;
  entries[at] = { ...entries[at], note: mergeNotes(entries[at].note, text) };
  orphans.delete(key);
}

export interface AddOutcome {
  data: LibraryData;
  /** Papers that were new to the library. */
  added: Paper[];
  /** Incoming papers that matched an existing entry and enriched it instead. */
  merged: number;
  /** The record id of each incoming paper, in order. */
  ids: string[];
}

/**
 * Adds papers, merging each into the entry it matches. `now` is the time stamped on new
 * entries: one value for all, or one per paper.
 */
export function addPapers(data: LibraryData, papers: readonly Paper[], now: number | readonly number[]): AddOutcome {
  const entries = [...data.entries];
  const orphans = new Map(data.orphans);
  const byId = new Map<string, number>();
  const byKey = new Map<string, number>();
  // Same rule as findEntryIndex, so "the record" for a paper is the same entry everywhere: an id match
  // first, else the first entry sharing an identity key.
  const index = (paper: Paper, at: number): void => {
    if (!byId.has(paper.id)) byId.set(paper.id, at);
    for (const key of paperKeys(paper)) if (!byKey.has(key)) byKey.set(key, at);
  };
  entries.forEach((e, i) => index(e.paper, i));

  const added: Paper[] = [];
  const ids: string[] = [];
  let merged = 0;
  papers.forEach((paper, i) => {
    const keyMatches = paperKeys(paper).map((k) => byKey.get(k)).filter((at): at is number => at !== undefined);
    const hit = byId.get(paper.id) ?? (keyMatches.length > 0 ? Math.min(...keyMatches) : undefined);
    let at: number;
    if (hit !== undefined) {
      entries[hit] = { ...entries[hit], paper: enrich(entries[hit].paper, paper) };
      index(entries[hit].paper, hit);
      merged++;
      at = hit;
    } else {
      entries.push({ paper, addedAt: typeof now === "number" ? now : (now[i] ?? Date.now()) });
      at = entries.length - 1;
      index(paper, at);
      added.push(paper);
    }
    // A note written when this paper had this id (before the library was the one record) is waiting.
    adoptOrphan(entries, orphans, paper.id, at);
    ids.push(entries[at].paper.id);
  });
  return { data: { ...data, entries, orphans }, added, merged, ids };
}

/**
 * Removes an entry. Its tags and status go with it, but a note is kept waiting under its id, as
 * the old annotations store did: saving the same paper again brings it back.
 */
export function removeEntry(data: LibraryData, id: string): LibraryData {
  const at = data.entries.findIndex((e) => e.paper.id === id);
  if (at < 0) return data;
  const orphans = new Map(data.orphans);
  const note = data.entries[at].note;
  if (note !== undefined) orphans.set(id, mergeNotes(orphans.get(id), note));
  return { ...data, entries: data.entries.filter((_, i) => i !== at), orphans };
}
