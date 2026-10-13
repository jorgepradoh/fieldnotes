/**
 * The local library: papers you saved, BibTeX you imported, PDFs and markdown
 * you dropped in. Metadata lives in library.json (readable, easy to back up);
 * file bytes live in IndexedDB (blobs.ts) keyed by content hash, so dropping
 * the same file twice never stores it twice.
 */
import { fileId } from "../library/files";
import { migrateAnnotations, migrateQueue, unusableNotes, unusableQueueItems } from "../library/migrate";
import {
  addPapers,
  adoptOrphan,
  findEntryIndex,
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
  type Migrated,
  type PaperStatus,
  type TagResult,
} from "../library/model";
import type { LocalFileRef, Paper } from "../sources/types";
import { deleteBlob, getBlob, putBlob } from "./blobs";
import { loadJson, loadLegacy, saveJson } from "./storage";
import { toast } from "./toast.svelte";

const FILE = "library.json";
const KEY = "library";
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

export interface AddResult {
  /** Papers that were new to the library. */
  added: Paper[];
  /** Incoming papers that matched an existing entry and enriched it instead. */
  merged: number;
}

export class LibraryState {
  entries = $state.raw<LibraryEntry[]>([]);
  loaded = $state(false);
  papers = $derived(this.entries.map((e) => e.paper));
  /** Notes written under an id no entry has yet; see library/model.ts. */
  orphans = $state.raw<Map<string, string>>(new Map());
  private migrated: Migrated = {};
  /** Top-level fields of library.json this build does not know, written back untouched. */
  private extra: Record<string, unknown> = {};
  private loading: Promise<void> | null = null;
  private writing = false;
  private dirty = false;
  /** The original library file, held until a copy of it has been stored (see keepBackup). */
  private pendingBackup: { raw: unknown } | null = null;
  /** Failed writes in a row, and the pending retry. */
  private failures = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;

  ensureLoaded(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    const raw = await loadJson<unknown>(FILE, KEY);
    const parsed = parseLibraryFile(raw);
    if (parsed.repaired > 0) await this.keepBackup(raw, parsed.repaired);
    this.extra = parsed.extra;
    const stored: LibraryData = { entries: parsed.entries, orphans: parsed.orphans, migrated: parsed.migrated };
    const data = await this.migrateOldStores(stored);
    this.apply(data);
    this.loaded = true;
    // Only a migration that ran changes the file; plain loading leaves it as it was.
    if (data !== stored) this.persist();
  }

  /**
   * Imports the old annotations and queue once. A store that can't be read is retried next launch.
   * Annotations go first: notes that match no entry wait as orphans, and the queue import then
   * hands each queued paper the note waiting under the id it was queued as, even when that paper
   * merges into an entry that has another id.
   */
  private async migrateOldStores(data: LibraryData): Promise<LibraryData> {
    let next = data;
    let unusable = 0;
    if (!next.migrated.annotations) {
      const notes = await readOldStore("annotations.json", "annotations");
      next = migrateAnnotations(next, notes);
      unusable += unusableNotes(notes);
    }
    if (!next.migrated.queue) {
      const queue = await readOldStore("queue.json", "queue");
      next = migrateQueue(next, queue, Date.now());
      unusable += unusableQueueItems(queue);
    }
    if (unusable > 0) {
      toast(
        `${unusable} ${unusable === 1 ? "item" : "items"} from your old reading queue or annotations could not be imported. The old files were left as they were.`,
        "info",
      );
    }
    return next;
  }

  /**
   * The file held something this build could not read as it was (damaged, from a newer version, or
   * sharing a paper id). The next write replaces it with the repaired library, so the original is
   * copied aside first, as the layouts file does. If the copy cannot be made, the original is held
   * back from being overwritten: every write first tries the copy again.
   */
  private async keepBackup(raw: unknown, repaired: number): Promise<void> {
    const what = `Some of your library file could not be read as it was (${repaired} ${repaired === 1 ? "item" : "items"}).`;
    try {
      await saveJson(FILE, `${KEY}.backup`, raw);
      toast(`${what} A copy of the original was kept.`, "info");
    } catch (err) {
      console.error("Could not back up the library file before repairing it", err);
      this.pendingBackup = { raw };
      toast(`${what} A copy of the original could not be saved, so your library will not be saved until it can be.`, "error");
    }
  }

  private data(): LibraryData {
    return { entries: this.entries, orphans: this.orphans, migrated: this.migrated };
  }

  private apply(data: LibraryData): void {
    this.entries = data.entries;
    this.orphans = data.orphans;
    this.migrated = data.migrated;
  }

  private commit(data: LibraryData): void {
    this.apply(data);
    this.persist();
  }

  /** Writing before the stored library has been read would overwrite it with a partial list. */
  private requireLoaded(): void {
    if (!this.loaded) throw new Error("The library is still loading.");
  }

  get(id: string): Paper | undefined {
    return this.entries.find((e) => e.paper.id === id)?.paper;
  }

  /** The library's copy of a paper from elsewhere (same id, DOI, arXiv id or title), if saved. */
  find(paper: Paper): Paper | undefined {
    const at = findEntryIndex(this.entries, paper);
    return at < 0 ? undefined : this.entries[at].paper;
  }

  // ------------------------------------------------------------ the record

  /** The record id of a paper from any source: the id of the entry it matches, if it is saved. */
  idFor(paper: Paper): string | undefined {
    return this.find(paper)?.id;
  }

  /**
   * The record id for a paper, saving it first if it isn't in the library. A note that was
   * written for this paper under its own id before the library was the one record is
   * brought along.
   */
  ensure(paper: Paper): string {
    this.requireLoaded();
    const at = findEntryIndex(this.entries, paper);
    if (at < 0) {
      const outcome = addPapers(this.data(), [paper], Date.now());
      this.commit(outcome.data);
      return outcome.ids[0];
    }
    if (this.orphans.has(paper.id)) {
      const entries = [...this.entries];
      const orphans = new Map(this.orphans);
      adoptOrphan(entries, orphans, paper.id, at);
      this.commit({ ...this.data(), entries, orphans });
    }
    return this.entries[at].paper.id;
  }

  /** True when a note from before the library was the one record is waiting for this paper to be saved. */
  hasOrphanNote(paper: Paper): boolean {
    return this.orphans.has(paper.id);
  }

  statusOf(id: string): PaperStatus | undefined {
    return this.entries.find((e) => e.paper.id === id)?.status;
  }

  noteOf(id: string): string {
    return this.entries.find((e) => e.paper.id === id)?.note ?? "";
  }

  /** Every tag in use with how many papers carry it, most used first. */
  tags(): { tag: string; count: number }[] {
    return tagCounts(this.entries);
  }

  /** Set (or with null, clear) the reading status. False when no such entry exists. */
  setStatus(id: string, status: PaperStatus | null, now = Date.now()): boolean {
    return this.update(id, (e) => withStatus(e, status, now));
  }

  setNote(id: string, text: string): boolean {
    return this.update(id, (e) => withNote(e, text));
  }

  addTag(id: string, raw: string): TagResult {
    let result: TagResult = "invalid";
    this.update(id, (e) => {
      const change = withTag(e, raw);
      result = change.result;
      return change.entry;
    });
    return result;
  }

  removeTag(id: string, raw: string): boolean {
    return this.update(id, (e) => withoutTag(e, raw));
  }

  /** Replace one entry; the same object back means nothing changed, so nothing is written. */
  private update(id: string, change: (entry: LibraryEntry) => LibraryEntry): boolean {
    this.requireLoaded();
    const at = this.entries.findIndex((e) => e.paper.id === id);
    if (at < 0) return false;
    const next = change(this.entries[at]);
    if (next !== this.entries[at]) {
      const entries = [...this.entries];
      entries[at] = next;
      this.entries = entries;
      this.persist();
    }
    return true;
  }

  // --------------------------------------------------------------- adding

  /** Add papers, merging duplicates into what is already there. One write for the whole batch. */
  addMany(papers: Paper[], now = Date.now()): AddResult {
    this.requireLoaded();
    const { data, added, merged } = addPapers(this.data(), papers, now);
    if (added.length > 0 || merged > 0) this.commit(data);
    return { added, merged };
  }

  add(paper: Paper): AddResult {
    return this.addMany([paper]);
  }

  /** Removes a paper with its tags and status; its note is kept waiting under its id (see removeEntry). */
  async remove(id: string): Promise<void> {
    const entry = this.entries.find((e) => e.paper.id === id);
    if (!entry) return;
    this.commit(removeEntry(this.data(), id));
    await this.dropFileIfUnused(entry.paper.localFile);
  }

  private async dropFileIfUnused(ref: LocalFileRef | undefined): Promise<void> {
    if (!ref || this.entries.some((e) => e.paper.localFile?.id === ref.id)) return;
    try {
      await deleteBlob(ref.id);
    } catch (err) {
      console.error("Could not delete a library file", err);
    }
  }

  /**
   * Store a file and add (or find) the entry for it. Identical bytes map to
   * the same entry, so dropping a PDF you already have just selects it.
   */
  async addDocument(input: {
    data: ArrayBuffer;
    mime: string;
    name: string;
    kind: "pdf" | "markdown";
    meta: Pick<Paper, "title" | "authors" | "year" | "abstract" | "venue">;
  }): Promise<{ paper: Paper; isNew: boolean }> {
    await this.ensureLoaded();
    const id = await fileId(input.data);
    const existing = this.entries.find((e) => e.paper.localFile?.id === id);
    if (existing) return { paper: existing.paper, isNew: false };

    await putBlob(id, input.data, input.mime);
    const paper: Paper = {
      id: `local:${id}`,
      source: "local",
      title: input.meta.title,
      authors: input.meta.authors,
      year: input.meta.year,
      venue: input.meta.venue,
      abstract: input.meta.abstract,
      tldr: null,
      citationCount: null,
      url: null,
      pdfUrl: null,
      doi: null,
      arxivId: null,
      localFile: { id, name: input.name, kind: input.kind, size: input.data.byteLength },
    };
    // A new file may match an existing record (same title…). Joining a record that has no file yet
    // is the point (a PDF for a BibTeX entry). Joining one that already has a *different* file
    // would silently drop this one, so in that case keep both as separate entries.
    const match = this.find(paper);
    if (match?.localFile && match.localFile.id !== id) {
      const entries = [...this.entries, { paper, addedAt: Date.now() }];
      const orphans = new Map(this.orphans);
      adoptOrphan(entries, orphans, paper.id, entries.length - 1); // a note kept when this file was removed
      this.commit({ ...this.data(), entries, orphans });
      return { paper, isNew: true };
    }
    this.addMany([paper]);
    // Hand back the library's own copy: after a merge it is the matched record, not `paper`.
    return { paper: this.find(paper) ?? paper, isNew: true };
  }

  /** Attach (or replace) the file behind an existing entry, e.g. a PDF for a BibTeX record. */
  async attachFile(paperId: string, data: ArrayBuffer, name: string, mime: string): Promise<Paper | null> {
    const entry = this.entries.find((e) => e.paper.id === paperId);
    if (!entry) return null;
    const id = await fileId(data);
    await putBlob(id, data, mime);
    const old = entry.paper.localFile;
    const paper: Paper = { ...entry.paper, localFile: { id, name, kind: "pdf", size: data.byteLength } };
    this.entries = this.entries.map((e) => (e.paper.id === paperId ? { ...e, paper } : e));
    this.persist();
    if (old && old.id !== id) await this.dropFileIfUnused(old);
    return paper;
  }

  async fileBytes(ref: LocalFileRef): Promise<Uint8Array | null> {
    const blob = await getBlob(ref.id);
    return blob ? new Uint8Array(blob.data) : null;
  }

  async fileText(ref: LocalFileRef): Promise<string | null> {
    const blob = await getBlob(ref.id);
    return blob ? new TextDecoder("utf-8").decode(blob.data) : null;
  }

  /**
   * Writes the whole library. The first write goes out at once; writes asked for while one
   * is in flight collapse into a single follow-up with the latest state, so typing a note
   * does not queue a rewrite of the file per pause. A failed write is reported once (not per
   * attempt) and retried with a growing delay (5 s, doubling, capped at 60 s). While failing,
   * edits do not trigger attempts of their own: the next retry writes whatever the state is by
   * then, so the load on a failing store follows the backoff, not how fast the user types.
   */
  private persist(): void {
    if (this.writing) {
      this.dirty = true;
      return;
    }
    if (this.failures > 0) return; // a retry is already scheduled
    this.start();
  }

  private start(): void {
    this.writing = true;
    const write = (): void => {
      if (this.retry) clearTimeout(this.retry);
      this.retry = null;
      this.dirty = false;
      // An async function: a storage layer that throws instead of returning a promise is a failed
      // write too, and must not leave `writing` set and stop all saving.
      const attempt = async (): Promise<void> => {
        if (this.pendingBackup) {
          await saveJson(FILE, `${KEY}.backup`, this.pendingBackup.raw);
          this.pendingBackup = null;
          toast("A copy of your original library file was kept.", "info");
        }
        await saveJson(FILE, KEY, serializeLibrary(this.data(), this.extra));
      };
      attempt()
        .then(
          () => {
            this.failures = 0;
          },
          (err: unknown) => {
            console.error("Could not save the library", err);
            if (this.failures++ === 0) {
              toast(
                "Could not save your library. Your latest changes are only in memory for now; saving will be retried.",
                "error",
              );
            }
            this.retry = setTimeout(() => {
              this.retry = null;
              this.start();
            }, Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (this.failures - 1)));
          },
        )
        .finally(() => {
          // Edits made during a write that succeeded go out as one follow-up; after a failure the
          // scheduled retry carries them.
          if (this.dirty && this.failures === 0) write();
          else this.writing = false;
        });
    };
    write();
  }
}

/** The old queue / annotations store, or undefined when it can't be read (logged, retried next launch). */
async function readOldStore(file: string, key: string): Promise<unknown> {
  try {
    return await loadLegacy<unknown>(file, key);
  } catch (err) {
    console.error(`Could not read ${file} to import it into the library`, err);
    return undefined;
  }
}

export const library = new LibraryState();
