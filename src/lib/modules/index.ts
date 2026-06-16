import { registerModule } from "$lib/core/registry";
import { annotationsModule } from "./annotations";
import { debugModule } from "./debug";
import { exportModule } from "./export";
import { libraryModule } from "./library";
import { notesModule } from "./notes";
import { pomodoroModule } from "./pomodoro";
import { queueModule } from "./queue";
import { readerModule } from "./reader";
import { searchModule } from "./search";

/** Adding a module to the app = create its folder, list it here. */
export function registerBuiltinModules(): void {
  for (const def of [
    searchModule,
    readerModule,
    libraryModule,
    annotationsModule,
    queueModule,
    notesModule,
    pomodoroModule,
    exportModule,
    debugModule,
  ]) {
    registerModule(def);
  }
}
