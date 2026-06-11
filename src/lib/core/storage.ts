/**
 * Workspace persistence. Inside Tauri this writes JSON to the app-data dir
 * via tauri-plugin-store; in a plain browser (vite dev without the shell)
 * it falls back to localStorage so the app stays usable.
 */
import type { Workspace } from "./types";

const KEY = "workspace";
const FILE = "workspace.json";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadWorkspace(): Promise<Workspace | null> {
  if (inTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(FILE);
    return (await store.get<Workspace>(KEY)) ?? null;
  }
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Workspace) : null;
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  if (inTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(FILE);
    await store.set(KEY, workspace);
    await store.save();
  } else {
    localStorage.setItem(KEY, JSON.stringify(workspace));
  }
}
