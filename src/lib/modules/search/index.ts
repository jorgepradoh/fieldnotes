import type { ModuleDefinition } from "$lib/core/types";
import Search from "./Search.svelte";

export const searchModule: ModuleDefinition = {
  id: "search",
  name: "Paper Search",
  icon: "🔍",
  description: "Search 200M+ papers via Semantic Scholar",
  component: Search,
  defaultSize: { w: 5, h: 6 },
  minSize: { w: 3, h: 3 },
  multiInstance: true,
};
