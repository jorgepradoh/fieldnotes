/**
 * Starter layouts offered under "New layout". Plain data: module ids and grid
 * rects (12 columns). Modules a given build doesn't have are skipped when a
 * preset is instantiated, so presets can mention modules ahead of time.
 */
import { newId, type ModuleLookup } from "./layouts";
import type { GridRect, ModuleInstance } from "./types";

export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  modules: { moduleId: string; position: GridRect }[];
}

export const PRESETS: LayoutPreset[] = [
  {
    id: "blank",
    name: "Blank",
    description: "An empty board",
    modules: [],
  },
  {
    id: "research",
    name: "Research",
    description: "Search, read, take notes",
    modules: [
      { moduleId: "search", position: { x: 0, y: 0, w: 4, h: 8 } },
      { moduleId: "reader", position: { x: 4, y: 0, w: 5, h: 8 } },
      { moduleId: "notes", position: { x: 9, y: 0, w: 3, h: 8 } },
    ],
  },
  {
    id: "survey",
    name: "Field survey",
    description: "Search a topic and get an AI brief",
    modules: [
      { moduleId: "search", position: { x: 0, y: 0, w: 4, h: 9 } },
      { moduleId: "synthesis", position: { x: 4, y: 0, w: 5, h: 9 } },
      { moduleId: "reader", position: { x: 9, y: 0, w: 3, h: 9 } },
    ],
  },
  {
    id: "reading",
    name: "Deep reading",
    description: "A big reader with notes beside it",
    modules: [
      { moduleId: "reader", position: { x: 0, y: 0, w: 8, h: 10 } },
      { moduleId: "notes", position: { x: 8, y: 0, w: 4, h: 7 } },
      { moduleId: "pomodoro", position: { x: 8, y: 7, w: 4, h: 3 } },
    ],
  },
  {
    id: "library",
    name: "Library triage",
    description: "Work through imported papers",
    modules: [
      { moduleId: "library", position: { x: 0, y: 0, w: 4, h: 8 } },
      { moduleId: "reader", position: { x: 4, y: 0, w: 5, h: 8 } },
      { moduleId: "synthesis", position: { x: 9, y: 0, w: 3, h: 8 } },
    ],
  },
];

export function getPreset(id: string): LayoutPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function instantiatePreset(
  preset: LayoutPreset,
  lookup: ModuleLookup,
  makeId: () => string = newId,
): ModuleInstance[] {
  return preset.modules
    .filter((m) => lookup(m.moduleId))
    .map((m) => ({
      instanceId: makeId(),
      moduleId: m.moduleId,
      position: { ...m.position },
      settings: {},
    }));
}
