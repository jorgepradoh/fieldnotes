/**
 * Reactive workspace state: which module instances are on the dashboard and
 * where. The dashboard mutates layout through here; modules store their
 * per-instance settings through here. Persists on every committed change.
 */
import { applyRect, contentHeight, findFreeSpot, packUp } from "./grid";
import { getModule } from "./registry";
import { loadWorkspace, saveWorkspace } from "./storage";
import type { GridRect, ModuleInstance } from "./types";

class WorkspaceState {
  name = $state("My workspace");
  instances = $state<ModuleInstance[]>([]);
  loaded = $state(false);

  rows = $derived(contentHeight(this.instances));

  async load(): Promise<void> {
    const saved = await loadWorkspace();
    if (saved) {
      this.name = saved.name;
      // Drop instances whose module no longer exists in the registry.
      this.instances = saved.instances.filter((it) => getModule(it.moduleId));
    }
    this.loaded = true;
  }

  add(moduleId: string): void {
    const def = getModule(moduleId);
    if (!def) return;
    if (!def.multiInstance && this.instances.some((it) => it.moduleId === moduleId)) return;
    const spot = findFreeSpot(this.instances, def.defaultSize.w, def.defaultSize.h);
    this.instances.push({
      instanceId: crypto.randomUUID(),
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

  private persist(): void {
    void saveWorkspace({
      name: this.name,
      instances: $state.snapshot(this.instances),
    });
  }
}

export const workspace = new WorkspaceState();
