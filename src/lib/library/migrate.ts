/**
 * One-time import of the two stores the library replaced: the reading queue
 * (queue.json) and per-paper annotations (annotations.json). The store runs the
 * annotations first, so notes that match no entry wait as orphans and the queue
 * import (through addPapers) hands each queued paper the note waiting under the id
 * it was queued as, even when that paper merges into an entry with another id. Both functions are
 * pure; they receive whatever the old store held, return the new library data,
 * and set `migrated.<name>` only when the input was a usable store so a repeat
 * run is a no-op. The old files are never touched or deleted.
 */
import type { Paper } from "../sources/types";
import {
  addPapers,
  adoptOrphan,
  isPaperLike,
  isStatus,
  mergeNotes,
  STATUSES,
  type LibraryData,
  type PaperStatus,
} from "./model";

function isQueueItem(item: unknown): boolean {
  return typeof item === "object" && item !== null && isPaperLike((item as { paper?: unknown }).paper);
}

/** How many items of the old queue the import cannot use (so the user can be told; the file is left as it is). */
export function unusableQueueItems(raw: unknown): number {
  return Array.isArray(raw) ? raw.filter((item) => !isQueueItem(item)).length : 0;
}

/** How many entries of the old annotations store are not text (blank text is not a note, so it is not counted). */
export function unusableNotes(raw: unknown): number {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return 0;
  return Object.values(raw).filter((text) => typeof text !== "string" && text !== null && text !== undefined).length;
}

interface QueuedPaper {
  paper: Paper;
  status: PaperStatus;
  at: number;
}

function parseQueue(raw: unknown[], now: number): QueuedPaper[] {
  const queued: QueuedPaper[] = [];
  for (const item of raw) {
    if (!isQueueItem(item)) continue;
    const { paper, status, addedAt } = item as { paper: Paper; status?: unknown; addedAt?: unknown };
    const parsed = typeof addedAt === "string" ? Date.parse(addedAt) : typeof addedAt === "number" ? addedAt : NaN;
    queued.push({ paper, status: isStatus(status) ? status : "to-read", at: Number.isFinite(parsed) ? parsed : now });
  }
  // Oldest first (the stable sort keeps the stored order for ties), so the library's
  // "recently added" order follows when each paper was queued.
  return queued.sort((a, b) => a.at - b.at);
}

/**
 * `raw` is the old queue: a list of { paper, status, addedAt }. Each paper is added to
 * the library (merging into the entry it matches, so one paper queued under two ids
 * becomes one record) and takes its queue status, unless that entry already has one.
 */
export function migrateQueue(data: LibraryData, raw: unknown, now: number): LibraryData {
  if (!Array.isArray(raw)) return data;
  const queued = parseQueue(raw, now);
  const outcome = addPapers(
    data,
    queued.map((q) => q.paper),
    queued.map((q) => q.at),
  );
  const entries = [...outcome.data.entries];
  const at = new Map(entries.map((e, i) => [e.paper.id, i]));
  // A status the entry had before this import is never replaced. When several queued items merge into
  // one record, the most advanced status wins: reading progress does not go backwards, and a paper
  // you have finished must not come back as "to read" because an older duplicate said so.
  const setHere = new Set<number>();
  queued.forEach((q, i) => {
    const index = at.get(outcome.ids[i]);
    if (index === undefined) return;
    const current = entries[index].status;
    const outranks = current !== undefined && setHere.has(index) && STATUSES.indexOf(q.status) > STATUSES.indexOf(current);
    if (current === undefined || outranks) {
      entries[index] = { ...entries[index], status: q.status, statusAt: q.at };
      setHere.add(index);
    }
  });
  return { ...outcome.data, entries, migrated: { ...data.migrated, queue: true } };
}

/**
 * `raw` is the old annotations store: { [paper id]: markdown }. A note whose id has an
 * entry becomes that entry's note (joined to any note it already has, never replacing
 * it); the rest wait in `orphans` and are adopted when a paper with that id arrives.
 */
export function migrateAnnotations(data: LibraryData, raw: unknown): LibraryData {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return data;
  const entries = [...data.entries];
  const orphans = new Map(data.orphans);
  const at = new Map(entries.map((e, i) => [e.paper.id, i]));
  for (const [id, text] of Object.entries(raw)) {
    if (typeof text !== "string" || text.trim() === "") continue;
    orphans.set(id, mergeNotes(orphans.get(id), text));
    const index = at.get(id);
    if (index !== undefined) adoptOrphan(entries, orphans, id, index);
  }
  return { entries, orphans, migrated: { ...data.migrated, annotations: true } };
}
