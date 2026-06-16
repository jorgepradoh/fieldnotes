import type { ModuleDefinition } from "$lib/core/types";
import Export from "./Export.svelte";

export const exportModule: ModuleDefinition = {
  id: "export",
  name: "Export",
  icon: "↗",
  description: "Export your library to BibTeX, Markdown, or JSON",
  component: Export,
  defaultSize: { w: 3, h: 4 },
  minSize: { w: 2, h: 3 },
};
