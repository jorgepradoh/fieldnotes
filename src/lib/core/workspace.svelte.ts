/**
 * Reactive workspace state: a set of named layouts, one of which is "live".
 * The live layout's modules are `instances` — the dashboard mutates layout
 * through here and modules store per-instance settings here. Every committed
 * change is persisted; switching layouts snapshots the live board first.
 *
 * Pure rules (validation, naming, export/import, migration) live in
 * layouts.ts; this class only holds state and sequences the calls.
 */
import { applyRect, contentHeight, findFreeSpot, packUp } from "./grid";
import {
  cleanName,
  exportLayout,
  layoutFileName,
  makeLayout,
  migrateLegacy,
  newId,
  normalizeLayoutsFile,
  uniqueName,
  type ModuleLookup,
  type ParsedLayoutImport,
} from "./layouts";
import { PRESETS, getPreset, instantiatePreset } from "./presets";
import { getModule } from "./registry";
import { loadJson, loadLegacyWorkspace, saveJson } from "./storage";
import type { GridRect, Layout, LayoutsFile, LegacyWorkspace, ModuleInstance } from "./types";

const FILE = "layouts.json";
const KEY = "layouts";

const lookup: ModuleLookup = (id) => getModule(id);

/** Fresh ids so two layouts never share an instance (settings are keyed by it). */
function withNewIds(instances: ModuleInstance[]): ModuleInstance[] {
  return instances.map((it) => ({
    ...structuredClone(it),
    instanceId: newId(),
  }));
}

/** Drop instances whose module is not registered in this build. */
function usable(instances: ModuleInstance[]): ModuleInstance[] {
  return structuredClone(instances).filter((it) => getModule(it.moduleId));
}

export class WorkspaceState {
  /** Snapshots of every layout. The active one is refreshed from `instances` on sync. */
  layouts = $state.raw<Layout[]>([]);
  activeId = $state("");
  /** The live board. */
  instances = $state<ModuleInstance[]>([]);
  loaded = $state(false);

  name = $derived(this.layouts.find((l) => l.id === this.activeId)?.name ?? "");
  rows = $derived(contentHeight(this.instances));

  async load(): Promise<void> {
    const stored = await loadJson<unknown>(FILE, KEY);
    let file = normalizeLayoutsFile(stored, lookup);
    let fresh = false;
    if (!file) {
      if (stored != null) {
        // Present but unusable (corrupt, or from a newer app): keep a copy before we write over it.
        saveJson(FILE, `${KEY}.backup`, stored).catch((err: unknown) => {
          console.error("Could not back up unreadable layouts", err);
        });
      }
      // First launch of a layouts-aware build: carry the old single workspace over…
      file = migrateLegacy(await loadLegacyWorkspace<LegacyWorkspace>(), lookup);
      fresh = true;
    }
    if (!file) {
      // …or, for a brand-new install, start from the Research starter.
      const preset = getPreset("research");
      const instances = preset ? instantiatePreset(preset, lookup) : [];
      const layout = makeLayout(preset?.name ?? "My workspace", instances);
      file = { version: 2, activeId: layout.id, layouts: [layout] };
    }
    this.layouts = file.layouts;
    this.activeId = file.activeId;
    this.instances = usable(this.requireActive().instances);
    this.loaded = true;
    if (fresh) this.persist();
  }

  private requireActive(): Layout {
    const active = this.layouts.find((l) => l.id === this.activeId);
    if (!active) throw new Error("No active layout");
    return active;
  }

  // ------------------------------------------------------------ live board

  add(moduleId: string): void {
    const def = getModule(moduleId);
    if (!def) return;
    if (!def.multiInstance && this.instances.some((it) => it.moduleId === moduleId)) return;
    const spot = findFreeSpot(this.instances, def.defaultSize.w, def.defaultSize.h);
    this.instances.push({
      instanceId: newId(),
      moduleId,
      position: spot,
      settings: {},
    });
    this.persist();
  }

  remove(instanceId: string): void {
    this.instances = packUp(this.instances.filter((it) => it.instanceId !== instanceId));
    this.persist();
  }

  /** Live layout update during a drag/resize — not persisted until commit(). */
  setRect(instanceId: string, target: GridRect): void {
    const def = getModule(
      this.instances.find((it) => it.instanceId === instanceId)?.moduleId ?? "",
    );
    const min = def?.minSize ?? { w: 1, h: 1 };
    this.instances = applyRect(this.instances, instanceId, target, min.w, min.h);
  }

  commit(): void {
    this.persist();
  }

  updateSettings(instanceId: string, patch: Record<string, unknown>): void {
    const inst = this.instances.find((it) => it.instanceId === instanceId);
    if (!inst) return;
    inst.settings = { ...inst.settings, ...patch };
    this.persist();
  }

  // --------------------------------------------------------------- layouts

  private names(except?: string): string[] {
    return this.layouts.filter((l) => l.id !== except).map((l) => l.name);
  }

  /** Copy the live board into the active layout's snapshot. */
  private syncActive(): void {
    const snapshot = $state.snapshot(this.instances) as ModuleInstance[];
    this.layouts = this.layouts.map((l) =>
      l.id === this.activeId ? { ...l, instances: snapshot, updatedAt: Date.now() } : l,
    );
  }

  private activate(id: string): void {
    const target = this.layouts.find((l) => l.id === id);
    if (!target) return;
    this.activeId = id;
    this.instances = usable(target.instances);
  }

  switchTo(id: string): void {
    if (id === this.activeId || !this.layouts.some((l) => l.id === id)) return;
    this.syncActive();
    this.activate(id);
    this.persist();
  }

  /** A new layout from a starter preset (default: empty). Becomes the active layout. */
  createLayout(name: string, presetId = "blank"): string {
    const preset = getPreset(presetId) ?? PRESETS[0];
    const layout = makeLayout(
      uniqueName(cleanName(name, preset.name), this.names()),
      instantiatePreset(preset, lookup),
    );
    this.syncActive();
    this.layouts = [...this.layouts, layout];
    this.activate(layout.id);
    this.persist();
    return layout.id;
  }

  /** Copy a layout under a new name. Does not switch to the copy. */
  duplicate(id: string, name?: string): string | null {
    this.syncActive();
    const source = this.layouts.find((l) => l.id === id);
    if (!source) return null;
    const copy = makeLayout(
      uniqueName(cleanName(name ?? `${source.name} copy`, source.name), this.names()),
      withNewIds(source.instances),
    );
    this.layouts = [...this.layouts, copy];
    this.persist();
    return copy.id;
  }

  /** "Save as": snapshot the live board under a new name and switch to the copy. */
  saveCurrentAs(name: string): string | null {
    const id = this.duplicate(this.activeId, name);
    if (id) this.switchTo(id);
    return id;
  }

  rename(id: string, name: string): void {
    const current = this.layouts.find((l) => l.id === id);
    if (!current) return;
    const next = uniqueName(cleanName(name, current.name), this.names(id));
    this.layouts = this.layouts.map((l) => (l.id === id ? { ...l, name: next } : l));
    this.persist();
  }

  /** Delete a layout. The last one cannot be deleted. */
  removeLayout(id: string): boolean {
    if (this.layouts.length <= 1 || !this.layouts.some((l) => l.id === id)) return false;
    this.syncActive();
    const remaining = this.layouts.filter((l) => l.id !== id);
    this.layouts = remaining;
    if (id === this.activeId) this.activate(remaining[0].id);
    this.persist();
    return true;
  }

  /** Add an already-validated import as a new layout and switch to it. */
  addImported(parsed: ParsedLayoutImport): string {
    const layout = makeLayout(
      uniqueName(cleanName(parsed.name, "Imported layout"), this.names()),
      parsed.instances,
    );
    this.syncActive();
    this.layouts = [...this.layouts, layout];
    this.activate(layout.id);
    this.persist();
    return layout.id;
  }

  /** The active layout as a shareable JSON string. Secrets are always stripped. */
  exportActive(includeContent: boolean): { fileName: string; json: string } {
    this.syncActive();
    const layout = this.requireActive();
    const data = exportLayout(layout, lookup, { includeContent });
    return { fileName: layoutFileName(layout.name), json: JSON.stringify(data, null, 2) };
  }

  private persist(): void {
    this.syncActive();
    const file: LayoutsFile = { version: 2, activeId: this.activeId, layouts: this.layouts };
    saveJson(FILE, KEY, file).catch((err: unknown) => {
      console.error("Could not save layouts", err);
    });
  }
}

export const workspace = new WorkspaceState();
