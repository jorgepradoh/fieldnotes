import { registerModule } from "$lib/core/registry";
import { debugModule } from "./debug";
import { notesModule } from "./notes";
import { pomodoroModule } from "./pomodoro";
import { searchModule } from "./search";

/** Adding a module to the app = create its folder, list it here. */
export function registerBuiltinModules(): void {
  for (const def of [searchModule, notesModule, pomodoroModule, debugModule]) {
    registerModule(def);
  }
}
