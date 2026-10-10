/**
 * One-time import of the two stores the library replaced: the reading queue
 * (queue.json) and per-paper annotations (annotations.json). Both functions are
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
  type LibraryData,
  type PaperStatus,
} from "./model";

interface QueuedPaper {
  paper: Paper;
  status: PaperStatus;
  at: number;
}

function parseQueue(raw: unknown[], now: number): QueuedPaper[] {
  const queued: QueuedPaper[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { paper, status, addedAt } = item as { paper?: unknown; status?: unknown; addedAt?: unknown };
    if (!isPaperLike(paper)) continue;
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
  queued.forEach((q, i) => {
    const index = at.get(outcome.ids[i]);
    if (index !== undefined && entries[index].status === undefined) {
      entries[index] = { ...entries[index], status: q.status, statusAt: q.at };
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
