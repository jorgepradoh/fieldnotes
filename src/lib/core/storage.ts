/**
 * Small-JSON persistence. Inside Tauri each `file` is a JSON file in the
 * app-data dir (tauri-plugin-store); in a plain browser (vite dev without the
 * shell) it falls back to localStorage so the app stays usable.
 *
 * Files in use: `layouts.json` (workspace layouts), `library.json` (local
 * library metadata), `ai.json` (provider profiles — kept out of layouts on
 * purpose so exporting a layout can never leak an API key).
 */
import type { Store } from "@tauri-apps/plugin-store";
import { inTauri } from "./net";

const stores = new Map<string, Promise<Store>>();

function openStore(file: string): Promise<Store> {
  let store = stores.get(file);
  if (!store) {
    store = import("@tauri-apps/plugin-store").then(({ load }) => load(file));
    stores.set(file, store);
  }
  return store;
}

function browserKey(file: string, key: string): string {
  return `fieldnotes:${file}:${key}`;
}

export async function loadJson<T>(file: string, key: string): Promise<T | null> {
  if (inTauri()) {
    const store = await openStore(file);
    return (await store.get<T>(key)) ?? null;
  }
  try {
    const raw = localStorage.getItem(browserKey(file, key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// Writes to one file are chained so a slow save can never land after a newer one.
const writeQueues = new Map<string, Promise<void>>();

export function saveJson(file: string, key: string, value: unknown): Promise<void> {
  const run = async (): Promise<void> => {
    if (inTauri()) {
      const store = await openStore(file);
      await store.set(key, value);
      await store.save();
    } else {
      localStorage.setItem(browserKey(file, key), JSON.stringify(value));
    }
  };
  const queued = (writeQueues.get(file) ?? Promise.resolve()).then(run, run);
  // Keep the chain alive after a failure; the caller still sees the rejection.
  writeQueues.set(
    file,
    queued.catch(() => undefined),
  );
  return queued;
}

/** The pre-layouts (v0.1) single-workspace record, read once for migration. */
export async function loadLegacyWorkspace<T>(): Promise<T | null> {
  if (inTauri()) {
    return loadJson<T>("workspace.json", "workspace");
  }
  try {
    const raw = localStorage.getItem("workspace");
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
