import type { ModuleDefinition } from "$lib/core/types";
import Pomodoro from "./Pomodoro.svelte";

export const pomodoroModule: ModuleDefinition = {
  id: "pomodoro",
  name: "Pomodoro",
  icon: "🍅",
  description: "Focus timer with work and break phases",
  component: Pomodoro,
  defaultSize: { w: 3, h: 3 },
  minSize: { w: 2, h: 3 },
};
