import type { Component } from "svelte";

/** Position and size on the dashboard grid, in grid units. */
export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A module placed on the dashboard. Pure data — this is what gets persisted. */
export interface ModuleInstance {
  instanceId: string;
  moduleId: string;
  position: GridRect;
  settings: Record<string, unknown>;
}

/** What a module is. Each module folder exports one of these. */
export interface ModuleDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  component: Component<{ instance: ModuleInstance }>;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  multiInstance?: boolean;
}

export interface Workspace {
  name: string;
  instances: ModuleInstance[];
}
