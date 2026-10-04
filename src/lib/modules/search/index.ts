import type { ModuleDefinition } from "$lib/core/types";
import Search from "./Search.svelte";

export const searchModule: ModuleDefinition = {
  id: "search",
  name: "Paper Search",
  icon: "🔎",
  description: "Search Semantic Scholar, OpenAlex and arXiv together",
  component: Search,
  defaultSize: { w: 4, h: 7 },
  minSize: { w: 3, h: 4 },
  multiInstance: true,
  // Never exported with a layout.
  secretSettings: ["apiKey", "openAlexKey", "email"],
};
