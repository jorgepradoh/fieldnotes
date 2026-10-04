# fieldnotes

A local-first desktop app for catching up on the state of the art of any field.
Type a topic, browse the top papers, read them, and let an LLM brief you on
where the field stands.

## Why

Tools like Elicit, Connected Papers, and ResearchRabbit each do a piece of
this, but they're cloud SaaS, single-purpose, and not customizable. fieldnotes
runs on your machine, uses your own API keys, and is built as a set of modules
you can rearrange — or extend with your own.

## Core ideas

- **Everything is a module.** The search bar, the results browser, the
  PDF/markdown reader, the AI synthesis panel — all modules in a customizable
  dashboard layout. Future modules (pomodoro timer, Spotify embed, citation
  graph…) plug into the same system.
- **Local-first.** Your library, notes, and keys live on your machine.
- **Bring your own LLM.** Anthropic API key or a local model via Ollama.
- **Open sources.** Papers come from free academic APIs — no scraping.

## Planned architecture

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (Rust) |
| UI | SvelteKit 2 + Svelte 5 + TypeScript |
| Paper sources | Semantic Scholar Academic Graph, arXiv, OpenAlex — behind a common source-adapter interface |
| AI | Anthropic API (BYO key) and Ollama (local), behind a common provider interface |
| Storage | Local (SQLite via Tauri) for library, layouts, settings |

### Roadmap

1. ~~**Module system** — registry, dashboard grid, layout persistence~~ ✓
2. ~~Search + results browser modules (Semantic Scholar first)~~ ✓
3. ~~Reader module (PDF in-app via PDF.js)~~ ✓ — local PDF/markdown files still pending
4. AI synthesis module — "state of the field" briefs from top-N results *(current)*
5. Chat-with-paper, citation graph, community modules

## Writing a module

Everything on the dashboard is a module. To add one:

1. Create `src/lib/modules/<your-module>/` with a Svelte component and an
   `index.ts` exporting a `ModuleDefinition`:

   ```ts
   import type { ModuleDefinition } from "$lib/core/types";
   import MyModule from "./MyModule.svelte";

   export const myModule: ModuleDefinition = {
     id: "my-module",
     name: "My Module",
     icon: "✨",
     description: "Shows up in the Add-module picker",
     component: MyModule,          // receives { instance: ModuleInstance }
     defaultSize: { w: 4, h: 4 },  // grid units (12 columns)
     minSize: { w: 2, h: 2 },
     multiInstance: true,          // allow several copies on the board
   };
   ```

2. Register it in `src/lib/modules/index.ts`. That's the only shared file you touch.

Rules of the system:

- **Modules never import other modules.** They communicate through the typed
  event bus (`$lib/core/bus.svelte.ts`) — emit and subscribe to events like
  `paper:selected`. New event types are added to the `BusEvents` interface.
- **Per-instance settings** go through `workspace.updateSettings(...)` and come
  back as `instance.settings` on next launch — that's all the persistence a
  module needs to think about.
- Layout (drag, resize, packing, saving) is entirely the dashboard's job;
  modules just fill whatever box they're given.

## Running it

### Option 1 — download a build

A v0.1.0 desktop build is published under Releases. It is unsigned, so on
macOS right-click → Open the first time.

### Option 2 — run from source (desktop app)

Prerequisites:

- [Node](https://nodejs.org) ≥ 20
- [Rust](https://rustup.rs) (stable)
- Platform libraries for Tauri 2 — see the
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):
  Xcode Command Line Tools on macOS; WebView2 + MSVC build tools on Windows;
  `webkit2gtk-4.1`, `libayatana-appindicator`, `librsvg` and a C toolchain on
  Linux.

```sh
git clone https://github.com/jorgepradoh/fieldnotes.git
cd fieldnotes
npm install
npm run tauri dev      # launches the desktop app with hot reload
```

### Option 3 — browser only (no Rust needed)

```sh
npm install
npm run dev            # http://localhost:1420
```

The UI runs in a plain browser with two differences: the layout is saved to
`localStorage` instead of the app-data directory, and PDFs are fetched with
the browser's `fetch`, so only publishers that send CORS headers will load.
Search works either way.

### Using it

1. Click **Add module** and add *Paper Search* and *Reader* (plus *Notes*,
   *Pomodoro*, *Debug* if you like).
2. Search a topic; click a paper — it opens in the Reader with its abstract and
   TL;DR, and the open-access PDF downloads in the background.
3. Drag modules by their header and resize them; the layout is restored on
   next launch.
4. Semantic Scholar works without a key but shares a rate pool (occasional
   429s). Add a free API key in the search module's settings to lift that.

## Development

```sh
npm run tauri dev      # desktop app, hot reload
npm run dev            # browser only
npm run check          # svelte-check / TypeScript
npm test               # vitest (grid packing, Semantic Scholar mapping)
npm run build          # static frontend into ./build
npm run tauri build    # packaged installer for your OS
```

### Project layout

```
src/lib/core/        module registry, event bus, grid maths, workspace state, storage, net
src/lib/components/  Dashboard, ModuleFrame, ModulePicker
src/lib/modules/     one folder per module (search, reader, notes, pomodoro, debug)
src/lib/sources/     paper-source adapters + the shared Paper model
src-tauri/           Rust shell (store, http and opener plugins; capabilities)
```

## Status

Early but usable (v0.1.0). Working today: module system with draggable,
resizable, persisted layout; Semantic Scholar search; in-app PDF reader;
notes, pomodoro and debug modules. **Not built yet:** the AI synthesis module,
Anthropic/Ollama providers, other paper sources (arXiv, OpenAlex), a local
library, local PDF/markdown files. The README's "Planned architecture" table
describes intent, not current state. No CI yet. Feedback and ideas welcome via
issues.

## License

MIT
