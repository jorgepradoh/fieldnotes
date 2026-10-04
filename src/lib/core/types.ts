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
  /**
   * `settings` keys that must never leave the machine — API keys, emails.
   * They are stripped when a layout is exported.
   */
  secretSettings?: string[];
}

/** A named board: which modules are placed where, plus their settings. */
export interface Layout {
  id: string;
  name: string;
  instances: ModuleInstance[];
  updatedAt: number;
}

/** What `layouts.json` holds. */
export interface LayoutsFile {
  version: 2;
  activeId: string;
  layouts: Layout[];
}

/** The v0.1 single-workspace record, kept only so it can be migrated. */
export interface LegacyWorkspace {
  name: string;
  instances: ModuleInstance[];
}
