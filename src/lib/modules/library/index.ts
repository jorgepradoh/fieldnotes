import type { ModuleDefinition } from "$lib/core/types";
import Library from "./Library.svelte";

export const libraryModule: ModuleDefinition = {
  id: "library",
  name: "Library",
  icon: "📚",
  description: "Your saved papers, PDFs, markdown notes and imported BibTeX",
  component: Library,
  defaultSize: { w: 4, h: 7 },
  minSize: { w: 3, h: 4 },
  multiInstance: false,
};
