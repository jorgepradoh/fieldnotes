import type { Paper } from "$lib/sources/types";

export interface LibraryEntry {
  paper: Paper;
  savedAt: string; // ISO timestamp
}

const KEY = "library";
const FILE = "library.json";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function hydrateEntries(): Promise<LibraryEntry[]> {
  if (inTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(FILE);
    return (await store.get<LibraryEntry[]>(KEY)) ?? [];
  }
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as LibraryEntry[]) : [];
}

async function persistEntries(entries: LibraryEntry[]): Promise<void> {
  if (inTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(FILE);
    await store.set(KEY, entries);
    await store.save();
  } else {
    localStorage.setItem(KEY, JSON.stringify(entries));
  }
}

class LibraryState {
  entries = $state<LibraryEntry[]>([]);
  loaded = $state(false);

  async load(): Promise<void> {
    this.entries = await hydrateEntries();
    this.loaded = true;
  }

  has(paperId: string): boolean {
    return this.entries.some((e) => e.paper.id === paperId);
  }

  add(paper: Paper): void {
    if (this.has(paper.id)) return;
    this.entries.unshift({ paper, savedAt: new Date().toISOString() });
    void persistEntries($state.snapshot(this.entries));
  }

  remove(paperId: string): void {
    this.entries = this.entries.filter((e) => e.paper.id !== paperId);
    void persistEntries($state.snapshot(this.entries));
  }
}

export const library = new LibraryState();
