import type { ModuleDefinition } from "$lib/core/types";
import Debug from "./Debug.svelte";

export const debugModule: ModuleDefinition = {
  id: "debug",
  name: "Debug",
  icon: "🔬",
  description: "Live event bus traffic and workspace JSON",
  component: Debug,
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
};
