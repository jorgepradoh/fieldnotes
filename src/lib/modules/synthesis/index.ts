import type { ModuleDefinition } from "$lib/core/types";
import Synthesis from "./Synthesis.svelte";

export const synthesisModule: ModuleDefinition = {
  id: "synthesis",
  name: "AI Brief",
  icon: "🧠",
  description: "A cited “state of the field” brief from your search results (Claude, OpenAI-compatible, local)",
  component: Synthesis,
  defaultSize: { w: 5, h: 9 },
  minSize: { w: 3, h: 5 },
  multiInstance: true,
};
