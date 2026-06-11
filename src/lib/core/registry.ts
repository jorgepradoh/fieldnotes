import type { ModuleDefinition } from "./types";

const modules = new Map<string, ModuleDefinition>();

/** Re-registering an id overwrites it (keeps HMR happy in dev). */
export function registerModule(def: ModuleDefinition): void {
  modules.set(def.id, def);
}

export function getModule(id: string): ModuleDefinition | undefined {
  return modules.get(id);
}

export function allModules(): ModuleDefinition[] {
  return [...modules.values()];
}
