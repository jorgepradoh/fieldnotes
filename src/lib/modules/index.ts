import { registerModule } from "$lib/core/registry";
import { debugModule } from "./debug";
import { libraryModule } from "./library";
import { notesModule } from "./notes";
import { pomodoroModule } from "./pomodoro";
import { readerModule } from "./reader";
import { searchModule } from "./search";
import { synthesisModule } from "./synthesis";

/** Adding a module to the app = create its folder, list it here. */
export function registerBuiltinModules(): void {
  for (const def of [
    searchModule,
    readerModule,
    synthesisModule,
    libraryModule,
    notesModule,
    pomodoroModule,
    debugModule,
  ]) {
    registerModule(def);
  }
}
