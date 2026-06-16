import type { ModuleDefinition } from "$lib/core/types";
import Queue from "./Queue.svelte";

export const queueModule: ModuleDefinition = {
  id: "queue",
  name: "Reading Queue",
  icon: "📋",
  description: "Track papers through To Read → Reading → Done",
  component: Queue,
  defaultSize: { w: 7, h: 6 },
  minSize: { w: 5, h: 4 },
};
