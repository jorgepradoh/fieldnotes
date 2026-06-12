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

## Development

Prerequisites: [Node](https://nodejs.org) ≥ 20, [Rust](https://rustup.rs), and
on macOS the Xcode Command Line Tools.

```sh
npm install
npm run tauri dev
```

## Status

Early scaffold — nothing usable yet. Feedback and ideas welcome via issues.
