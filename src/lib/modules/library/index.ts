import type { ModuleDefinition } from "$lib/core/types";
import Library from "./Library.svelte";

export const libraryModule: ModuleDefinition = {
  id: "library",
  name: "Library",
  icon: "📚",
  description: "Save papers and return to them across sessions",
  component: Library,
  defaultSize: { w: 3, h: 6 },
  minSize: { w: 2, h: 4 },
};
