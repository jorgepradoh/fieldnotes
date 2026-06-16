import type { ModuleDefinition } from "$lib/core/types";
import Annotations from "./Annotations.svelte";

export const annotationsModule: ModuleDefinition = {
  id: "annotations",
  name: "Annotations",
  icon: "✏️",
  description: "Per-paper notes that persist across sessions",
  component: Annotations,
  defaultSize: { w: 4, h: 5 },
  minSize: { w: 2, h: 3 },
  multiInstance: true,
};
