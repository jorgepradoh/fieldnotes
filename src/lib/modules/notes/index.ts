import type { ModuleDefinition } from "$lib/core/types";
import Notes from "./Notes.svelte";

export const notesModule: ModuleDefinition = {
  id: "notes",
  name: "Notes",
  icon: "📝",
  description: "Markdown notes with live preview",
  component: Notes,
  defaultSize: { w: 4, h: 5 },
  minSize: { w: 2, h: 2 },
  multiInstance: true,
};
