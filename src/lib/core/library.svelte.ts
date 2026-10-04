/**
 * The local library: papers you saved, BibTeX you imported, PDFs and markdown
 * you dropped in. Metadata lives in library.json (readable, easy to back up);
 * file bytes live in IndexedDB (blobs.ts) keyed by content hash, so dropping
 * the same file twice never stores it twice.
 */
import { fileId } from "../library/files";
import { mergePapers, paperKeys } from "../sources/merge";
import type { LocalFileRef, Paper } from "../sources/types";
import { deleteBlob, getBlob, putBlob } from "./blobs";
import { loadJson, saveJson } from "./storage";

const FILE = "library.json";
const KEY = "library";

export interface LibraryEntry {
  paper: Paper;
  addedAt: number;
}

interface LibraryFile {
  version: 1;
  entries: LibraryEntry[];
}

export interface AddResult {
  /** Papers that were new to the library. */
  added: Paper[];
  /** Incoming papers that matched an existing entry and enriched it instead. */
  merged: number;
}

function isEntry(value: unknown): value is LibraryEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as { paper?: Partial<Paper>; addedAt?: unknown };
  return (
    typeof e.addedAt === "number" &&
    typeof e.paper === "object" &&
    e.paper !== null &&
    typeof e.paper.id === "string" &&
    typeof e.paper.title === "string" &&
    Array.isArray(e.paper.authors)
  );
}

/** Enrich `existing` with whatever `incoming` knows, keeping the library's own id and file. */
function enrich(existing: Paper, incoming: Paper): Paper {
  const merged = mergePapers(existing, incoming);
  delete merged.sources;
  return { ...merged, id: existing.id, source: existing.source, localFile: existing.localFile ?? incoming.localFile };
}

export class LibraryState {
  entries = $state.raw<LibraryEntry[]>([]);
  loaded = $state(false);
  papers = $derived(this.entries.map((e) => e.paper));
  private loading: Promise<void> | null = null;

  ensureLoaded(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    const raw = await loadJson<LibraryFile>(FILE, KEY);
    this.entries = Array.isArray(raw?.entries) ? raw.entries.filter(isEntry) : [];
    this.loaded = true;
  }

  get(id: string): Paper | undefined {
    return this.entries.find((e) => e.paper.id === id)?.paper;
  }

  /** The library's copy of a paper from elsewhere (same id, DOI, arXiv id or title), if saved. */
  find(paper: Paper): Paper | undefined {
    const keys = new Set(paperKeys(paper));
    return this.entries.find((e) => e.paper.id === paper.id || paperKeys(e.paper).some((k) => keys.has(k)))?.paper;
  }

  /** Add papers, merging duplicates into what is already there. One write for the whole batch. */
  addMany(papers: Paper[], now = Date.now()): AddResult {
    // Writing before the stored library has been read would overwrite it with a partial list.
    if (!this.loaded) throw new Error("The library is still loading.");
    const entries = [...this.entries];
    const byId = new Map<string, number>();
    const byKey = new Map<string, number>();
    const index = (paper: Paper, at: number): void => {
      byId.set(paper.id, at);
      for (const key of paperKeys(paper)) byKey.set(key, at);
    };
    entries.forEach((e, i) => index(e.paper, i));

    const added: Paper[] = [];
    let merged = 0;
    for (const paper of papers) {
      const hit = byId.get(paper.id) ?? paperKeys(paper).map((k) => byKey.get(k)).find((i) => i !== undefined);
      if (hit !== undefined) {
        entries[hit] = { ...entries[hit], paper: enrich(entries[hit].paper, paper) };
        index(entries[hit].paper, hit);
        merged++;
      } else {
        entries.push({ paper, addedAt: now });
        index(paper, entries.length - 1);
        added.push(paper);
      }
    }
    if (added.length > 0 || merged > 0) {
      this.entries = entries;
      this.persist();
    }
    return { added, merged };
  }

  add(paper: Paper): AddResult {
    return this.addMany([paper]);
  }

  async remove(id: string): Promise<void> {
    const entry = this.entries.find((e) => e.paper.id === id);
    if (!entry) return;
    this.entries = this.entries.filter((e) => e.paper.id !== id);
    this.persist();
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
      this.entries = [...this.entries, { paper, addedAt: Date.now() }];
      this.persist();
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

  private persist(): void {
    const file: LibraryFile = { version: 1, entries: this.entries };
    saveJson(FILE, KEY, file).catch((err: unknown) => {
      console.error("Could not save the library", err);
    });
  }
}

export const library = new LibraryState();
