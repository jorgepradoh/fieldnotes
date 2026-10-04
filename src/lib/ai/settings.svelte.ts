/**
 * Saved model profiles. Kept in their own file (ai.json), separate from
 * layouts, so API keys can never ride along when a layout is exported.
 * Stored on this machine unencrypted, like the other settings.
 */
import { loadJson, saveJson } from "../core/storage";
import { normalizeAiFile, type AiFile } from "./profiles";
import type { ProviderProfile } from "./types";

const FILE = "ai.json";
const KEY = "settings";

class AiSettings {
  profiles = $state.raw<ProviderProfile[]>([]);
  activeId = $state("");
  loaded = $state(false);
  private loading: Promise<void> | null = null;

  /** Safe to call from every module instance; loads once. */
  ensureLoaded(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    const file = normalizeAiFile(await loadJson<unknown>(FILE, KEY));
    this.profiles = file.profiles;
    this.activeId = file.activeId;
    this.loaded = true;
  }

  get(id: string): ProviderProfile | undefined {
    return this.profiles.find((p) => p.id === id);
  }

  /** The profile a module should use: its own pick if it still exists, else the default. */
  resolve(id: string | undefined): ProviderProfile | undefined {
    return (id ? this.get(id) : undefined) ?? this.get(this.activeId) ?? this.profiles[0];
  }

  add(profile: ProviderProfile): void {
    this.profiles = [...this.profiles, profile];
    if (!this.activeId) this.activeId = profile.id;
    this.persist();
  }

  update(profile: ProviderProfile): void {
    this.profiles = this.profiles.map((p) => (p.id === profile.id ? profile : p));
    this.persist();
  }

  setActive(id: string): void {
    if (!this.get(id)) return;
    this.activeId = id;
    this.persist();
  }

  remove(id: string): void {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.activeId === id) this.activeId = this.profiles[0]?.id ?? "";
    this.persist();
  }

  private persist(): void {
    const file: AiFile = { version: 1, activeId: this.activeId, profiles: this.profiles };
    saveJson(FILE, KEY, file).catch((err: unknown) => {
      console.error("Could not save AI settings", err);
    });
  }
}

export const aiSettings = new AiSettings();
