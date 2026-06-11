import { registerModule } from "$lib/core/registry";
import { debugModule } from "./debug";
import { notesModule } from "./notes";
import { pomodoroModule } from "./pomodoro";
import { searchStubModule } from "./search-stub";

/** Adding a module to the app = create its folder, list it here. */
export function registerBuiltinModules(): void {
  for (const def of [searchStubModule, notesModule, pomodoroModule, debugModule]) {
    registerModule(def);
  }
}
