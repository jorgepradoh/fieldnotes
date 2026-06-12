import type { ModuleDefinition } from "$lib/core/types";
import Reader from "./Reader.svelte";

export const readerModule: ModuleDefinition = {
  id: "reader",
  name: "Reader",
  icon: "📖",
  description: "Read selected papers in-app (overview + PDF)",
  component: Reader,
  defaultSize: { w: 7, h: 8 },
  minSize: { w: 4, h: 4 },
  multiInstance: true,
};
