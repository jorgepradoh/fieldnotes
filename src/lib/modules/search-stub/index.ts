import type { ModuleDefinition } from "$lib/core/types";
import SearchStub from "./SearchStub.svelte";

export const searchStubModule: ModuleDefinition = {
  id: "search-stub",
  name: "Paper Search",
  icon: "🔍",
  description: "Search papers (stub — emits real bus events)",
  component: SearchStub,
  defaultSize: { w: 5, h: 5 },
  minSize: { w: 3, h: 3 },
};
