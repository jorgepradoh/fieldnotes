import type { Paper } from "$lib/sources/types";

export type QueueStatus = "to-read" | "reading" | "done";

export interface QueueEntry {
  paper: Paper;
  status: QueueStatus;
  addedAt: string;
}

const KEY = "queue";
const FILE = "queue.json";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function hydrateQueue(): Promise<QueueEntry[]> {
  if (inTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(FILE);
    return (await store.get<QueueEntry[]>(KEY)) ?? [];
  }
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as QueueEntry[]) : [];
}

async function persistQueue(entries: QueueEntry[]): Promise<void> {
  if (inTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(FILE);
    await store.set(KEY, entries);
    await store.save();
  } else {
    localStorage.setItem(KEY, JSON.stringify(entries));
  }
}

const STATUS_ORDER: QueueStatus[] = ["to-read", "reading", "done"];

class QueueState {
  entries = $state<QueueEntry[]>([]);
  loaded = $state(false);

  async load(): Promise<void> {
    this.entries = await hydrateQueue();
    this.loaded = true;
  }

  has(paperId: string): boolean {
    return this.entries.some((e) => e.paper.id === paperId);
  }

  add(paper: Paper): void {
    if (this.has(paper.id)) return;
    this.entries.unshift({ paper, status: "to-read", addedAt: new Date().toISOString() });
    void persistQueue($state.snapshot(this.entries));
  }

  /** Advance to the next status, or remove if already at "done". */
  advance(paperId: string): void {
    const entry = this.entries.find((e) => e.paper.id === paperId);
    if (!entry) return;
    const idx = STATUS_ORDER.indexOf(entry.status);
    if (idx === STATUS_ORDER.length - 1) {
      this.remove(paperId);
    } else {
      entry.status = STATUS_ORDER[idx + 1];
      void persistQueue($state.snapshot(this.entries));
    }
  }

  remove(paperId: string): void {
    this.entries = this.entries.filter((e) => e.paper.id !== paperId);
    void persistQueue($state.snapshot(this.entries));
  }

  column(status: QueueStatus): QueueEntry[] {
    return this.entries.filter((e) => e.status === status);
  }
}

export const queue = new QueueState();
