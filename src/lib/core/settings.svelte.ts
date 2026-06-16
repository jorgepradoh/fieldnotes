import type { AppSettings } from "./types";

const KEY = "settings";
const FILE = "settings.json";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function hydrateSettings(): Promise<AppSettings> {
  if (inTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(FILE);
    return (await store.get<AppSettings>(KEY)) ?? {};
  }
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as AppSettings) : {};
}

async function persistSettings(s: AppSettings): Promise<void> {
  if (inTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(FILE);
    await store.set(KEY, s);
    await store.save();
  } else {
    localStorage.setItem(KEY, JSON.stringify(s));
  }
}

class SettingsState {
  data = $state<AppSettings>({});
  loaded = $state(false);

  async load(): Promise<void> {
    this.data = await hydrateSettings();
    this.loaded = true;
  }

  update(patch: Partial<AppSettings>): void {
    this.data = { ...this.data, ...patch };
    void persistSettings($state.snapshot(this.data));
  }
}

export const settings = new SettingsState();
