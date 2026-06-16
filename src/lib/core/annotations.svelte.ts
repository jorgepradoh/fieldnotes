/**
 * Global per-paper annotation store. Keyed by paper.id so notes survive
 * module removal/re-addition. Persisted to annotations.json separately from
 * the workspace so the library isn't lost if a module instance is deleted.
 */

type AnnotationMap = Record<string, string>;

const KEY = "annotations";
const FILE = "annotations.json";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function hydrateAnnotations(): Promise<AnnotationMap> {
  if (inTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(FILE);
    return (await store.get<AnnotationMap>(KEY)) ?? {};
  }
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as AnnotationMap) : {};
}

async function persistAnnotations(notes: AnnotationMap): Promise<void> {
  if (inTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(FILE);
    await store.set(KEY, notes);
    await store.save();
  } else {
    localStorage.setItem(KEY, JSON.stringify(notes));
  }
}

class AnnotationsState {
  notes = $state<AnnotationMap>({});
  loaded = $state(false);

  async load(): Promise<void> {
    this.notes = await hydrateAnnotations();
    this.loaded = true;
  }

  get(paperId: string): string {
    return this.notes[paperId] ?? "";
  }

  set(paperId: string, text: string): void {
    this.notes[paperId] = text;
    void persistAnnotations($state.snapshot(this.notes));
  }
}

export const annotations = new AnnotationsState();
