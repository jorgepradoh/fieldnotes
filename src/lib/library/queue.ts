/**
 * The Queue module is a view over library entries that have a status. These
 * are its rules, kept out of the component so they can be tested.
 */
import { STATUSES, type LibraryEntry, type PaperStatus } from "./model";

export const STATUS_LABEL: Record<PaperStatus, string> = {
  "to-read": "To Read",
  reading: "Reading",
  done: "Done",
};

/** The button on a card: move it along, or (once done) take it off the queue. */
export const ADVANCE_LABEL: Record<PaperStatus, string> = {
  "to-read": "Start →",
  reading: "Done →",
  done: "Remove",
};

/** The status after this one, or null when the paper leaves the queue (it stays in the library). */
export function nextStatus(status: PaperStatus): PaperStatus | null {
  const next = STATUSES[STATUSES.indexOf(status) + 1];
  return next ?? null;
}

/** Entries by status, most recently moved into the column first. */
export function queueColumns(entries: readonly LibraryEntry[]): Record<PaperStatus, LibraryEntry[]> {
  const columns: Record<PaperStatus, LibraryEntry[]> = { "to-read": [], reading: [], done: [] };
  for (const entry of entries) if (entry.status) columns[entry.status].push(entry);
  for (const status of STATUSES) {
    // Stable sort: entries moved at the same instant keep the library's order.
    columns[status].sort((a, b) => (b.statusAt ?? b.addedAt) - (a.statusAt ?? a.addedAt));
  }
  return columns;
}
