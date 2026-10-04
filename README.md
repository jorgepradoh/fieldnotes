# fieldnotes

A local-first desktop app for catching up on the state of the art of any field.
Type a topic, browse the top papers from several sources, read them, and let an
LLM brief you on where the field stands — with citations you can click.

## Why

Tools like Elicit, Connected Papers, and ResearchRabbit each do a piece of
this, but they're cloud SaaS, single-purpose, and not customizable. fieldnotes
runs on your machine, uses your own API keys (or a model running locally), and
is built as a set of modules you can rearrange — or extend with your own.

## What's in it

| Module | What it does |
|---|---|
| 🔎 **Paper Search** | Searches Semantic Scholar, OpenAlex and arXiv together, merges duplicates, filters by year / citations / open access, sorts by relevance, citations or date. |
| 📖 **Reader** | Overview (abstract, TL;DR) plus an in-app PDF viewer. Opens open-access PDFs, your own PDFs, and markdown notes. |
| 🧠 **AI Brief** | Turns the current search results (or your library) into a cited “state of the field” briefing. Claude, OpenAI, OpenRouter, Ollama, LM Studio, or any OpenAI-compatible server. |
| 📚 **Library** | Papers you saved, PDFs and markdown you dropped in, BibTeX you imported. |
| 📝 **Notes** | Markdown notes in a CodeMirror editor (optional **Vim mode** under ⚙ Settings) with live preview (raw HTML is shown as text, never run). |
| ✏️ **Annotations** | Notes per paper: select a paper and write about it; they persist across sessions and travel with an export. |
| 📋 **Reading Queue** | Move papers through To Read → Reading → Done. |
| ↗ **Export** | Writes your library as BibTeX, Markdown or JSON, with your annotations. |
| 🍅 **Pomodoro**, 🐞 **Debug** | A focus timer; a live view of the event bus. |

Everything sits on a drag-and-resize dashboard. Save arrangements as **named
layouts**, start from presets, and export/import them as files. **Focus mode**
(⌘⇧F / Ctrl+Shift+F, or the ⊡ button) hides the chrome, and in the desktop app
goes full screen.

## Core ideas

- **Everything is a module.** Modules never import each other; they talk
  through a typed event bus, so you can add, remove and rearrange them freely.
- **Local-first.** Your library, notes, layouts and keys live on your machine.
- **Bring your own LLM.** Anthropic, OpenAI, OpenRouter, or anything that speaks
  the OpenAI Chat Completions protocol — including models on your own computer.
- **Open sources.** Papers come from free academic APIs — no scraping.

## Running it

### Option 1 — download a build

A desktop build is published under Releases. It is unsigned, so on macOS
right-click → Open the first time.

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

The UI runs in a plain browser with some differences, because the desktop app
makes its network requests from Rust (no CORS) and a browser cannot:

| | Desktop app | Browser (`npm run dev`) |
|---|---|---|
| Layouts, settings | App-data folder | `localStorage` |
| Library files | IndexedDB in the app's webview | IndexedDB in the browser |
| Semantic Scholar, OpenAlex | ✓ | ✓ |
| arXiv | ✓ | ✗ (its API sends no CORS headers) |
| PDFs from publishers | ✓ | only hosts that allow CORS |
| Anthropic / OpenAI / OpenRouter | ✓ | ✓ where the provider allows browser requests (Anthropic needs its browser-access header, which the app sends) |
| Ollama / LM Studio | ✓ | only if the server allows CORS (`OLLAMA_ORIGINS=*`) |
| Saving a file (export, brief) | native Save dialog | browser download |

## Using it

1. Click **Add module** and add what you need — or open the layout menu (the
   name next to the logo) and start a **New layout** from a preset such as
   *Research* or *Field survey*.
2. **Search** a topic. Toggle sources with the `S2` / `OA` / `arXiv` chips, open
   **Filters** to narrow by year, minimum citations or open access, and pick a
   sort order. A paper found by several sources appears once, with a badge for
   each.
3. Click a paper — it opens in the **Reader** with its abstract and TL;DR, and
   an open-access PDF downloads in the background. **Save to library** keeps it.
4. In **AI Brief**, set up a model once (below), then **Write brief**. Choose how
   many papers to include, tick/untick individual ones, add an optional focus
   (“safety and evaluation”), and pick a length. `[n]` markers in the text open
   the cited paper; **Copy markdown** / **Save .md** export it with its sources.
5. **Drop** PDFs, markdown notes, a `.bib` file or a layout file anywhere on the
   window to import them.

## AI setup

Open the ⚙ in **AI Brief** → *Set up a model* and pick a starting point:

| Provider | Base URL | Key | Notes |
|---|---|---|---|
| **Anthropic (Claude)** | `https://api.anthropic.com` | required | Default model `claude-opus-5-5`. Uses the official SDK. If the safeguards decline a request it is re-run on a fallback model automatically (toggle in settings). |
| **OpenAI** | `https://api.openai.com/v1` | required | Click **Load models** to pick one. |
| **OpenRouter** | `https://openrouter.ai/api/v1` | required | One key, many hosted models. |
| **Ollama** | `http://localhost:11434/v1` | none | See the context-window note below. |
| **LM Studio** | `http://localhost:1234/v1` | none | Start its local server first. |
| **Other OpenAI-compatible** | your URL (usually ends in `/v1`) | optional | vLLM, llama.cpp, LiteLLM, Together, Groq… Plain `http` is allowed for `localhost` / `127.0.0.1` only. |

You can keep several profiles and switch between them per AI Brief module.
**Load models** lists what the server offers and doubles as a connection test.

- **Keys** are stored on this machine in plain text (in `ai.json`, next to your
  other settings) and are **never** included in exported layouts. Requests go
  directly from the app to the base URL you set.
- **Ollama and long prompts.** Ollama's default context window is small and it
  silently truncates anything longer. Start it with a larger one, e.g.
  `OLLAMA_CONTEXT_LENGTH=16384 ollama serve`, or lower the paper count. The
  module shows an estimated prompt size and warns about local models.
- **Max output tokens** and (for OpenAI-compatible servers) the *output-limit
  parameter* are in the profile. “auto” sends `max_completion_tokens` to
  `api.openai.com` and `max_tokens` everywhere else.
- Briefings are written from **titles, abstracts and citation counts only** —
  not full texts — and say so. They are AI-generated: check claims against the
  papers (the `[n]` links make that quick).

## Sources

| Source | Gives you | Key | Notes |
|---|---|---|---|
| **Semantic Scholar** | abstracts, TL;DRs, citation counts, open-access PDFs | optional | Shared rate pool without a key (occasional 429s); a free key lifts it. |
| **OpenAlex** | broad coverage, citation counts, open-access PDFs | optional | An email puts you in the faster “polite pool”; an API key is sent if you set one. |
| **arXiv** | preprints, always with a PDF; no citation counts | none | Desktop app only. When a citation minimum is set, arXiv drops out of the results. |
| **Zotero** | items from your own Zotero library | none | Desktop app only; Zotero must be running with its local API enabled. Off by default: switch on the Zotero chip in Paper Search. Read-only. |

Add keys and your email in the Paper Search ⚙ panel. A failing or rate-limited
source shows a warning with **Retry** while the others' results stay. Results
from different sources are recognised as the same paper by DOI, arXiv id or
title, merged (best abstract, highest citation count, any open PDF), and ranked
with reciprocal rank fusion, so a paper several sources agree on rises.

## Library, local files and BibTeX

Drop files anywhere on the window, or use **Import…** in the Library:

| File | What happens |
|---|---|
| `.pdf` | Stored in the library. The title/author come from the PDF's metadata when believable, otherwise the file name. Opens in the Reader. |
| `.md`, `.markdown`, `.txt` | Stored in the library; title, authors, date and a short abstract are read from front matter / the first heading. Rendered safely in the Reader. |
| `.bib` | Every entry becomes a library record (LaTeX accents decoded; `Last, First` names fixed; arXiv ids get an open PDF link). Entries already in the library are merged, not duplicated. Problems in individual entries are reported without failing the file. |
| `.json` | A fieldnotes layout (see below). |

Identical files are recognised by content, so dropping the same PDF twice
stores it once. A BibTeX record without a PDF has a **＋PDF** button to attach
your own copy. Limits: PDFs up to 150 MB, text files up to 8 MB.

Where things live: metadata in `library.json` in the app-data folder; file
contents in the webview's IndexedDB. That means the files are **not** loose
files you can browse, and clearing the app's web storage removes them. The
**Export** module writes the library's metadata and your annotations as BibTeX,
Markdown or JSON; exporting the stored files themselves is on the
[ideas list](docs/IDEAS.md).

## Layouts

The layout menu (next to the logo) holds **named layouts**: each is a board of
modules plus their settings (notes text, queries, the last brief), so switching
layouts switches your whole workspace.

- **New layout** from a preset — *Blank*, *Research*, *Field survey*, *Deep
  reading*, *Library triage* — **Save current as…**, rename, duplicate, delete.
- **Export** writes a `*.fieldnotes-layout.json` file. By default only the
  arrangement is exported; tick *Include module contents* to also include notes,
  queries and the last brief. **API keys and your email are never exported.**
- **Import** (or drop the file on the window) adds it as a *new* layout and
  never overwrites one. Imports are validated: unknown modules are skipped and
  reported, positions are clamped and de-overlapped, single-use modules aren't
  duplicated.
- Upgrading from v0.1 keeps your old workspace as your first layout (the old
  file is left untouched). A `layouts.json` that can't be read is backed up
  before anything is written over it.

## Architecture

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (Rust): store, http, dialog, fs and opener plugins |
| UI | SvelteKit 2 + Svelte 5 + TypeScript |
| Paper sources | Semantic Scholar, OpenAlex, arXiv and your local Zotero behind one `PaperSource` interface; a federated layer merges, ranks, filters and sorts |
| Editor | CodeMirror 6 for notes and annotations, with optional Vim keybindings (`@replit/codemirror-vim`) |
| AI | `LlmProvider` interface: Anthropic (official SDK) and OpenAI-compatible REST (SSE streaming) |
| Storage | JSON files via the Tauri store plugin (layouts, library metadata, AI profiles) and IndexedDB (file contents) |
| Untrusted text | LLM output and dropped markdown go through a sanitising renderer: raw HTML escaped, images and non-web links dropped |
| PDFs | pdf.js, using its “legacy” build so older WebKitGTK / WebView2 / WKWebView versions work |

### Roadmap

1. ~~**Module system** — registry, dashboard grid, layout persistence~~ ✓
2. ~~Search + results browser modules~~ ✓ — Semantic Scholar, OpenAlex, arXiv, filters, merge
3. ~~Reader module~~ ✓ — open-access PDFs, local PDFs, markdown
4. ~~AI synthesis module~~ ✓ — cited briefs; Claude, OpenAI-compatible, local models
5. ~~Local library~~ ✓ — drag-and-drop files, BibTeX import
6. ~~Named layouts~~ ✓ — presets, export/import
7. ~~Writing and organising~~ ✓ — CodeMirror notes with Vim mode, annotations, reading queue, library export (BibTeX / Markdown / JSON), Zotero search, focus mode
8. Chat-with-paper, citation graph, exporting the stored files, community modules *(next)*

Further ideas, including **Obsidian integration** (notes, graph, diagrams), are
parked in [`docs/IDEAS.md`](docs/IDEAS.md).

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
     secretSettings: ["apiKey"],   // settings keys that must never be exported
   };
   ```

2. Register it in `src/lib/modules/index.ts`. That's the only shared file you touch.

Rules of the system:

- **Modules never import other modules.** They communicate through the typed
  event bus (`$lib/core/bus.svelte.ts`) — emit and subscribe to events like
  `paper:selected` or `search:results`. New event types are added to the
  `BusEvents` interface. `latest(name)` returns the most recent payload, so a
  module added late can catch up.
- **Per-instance settings** go through `workspace.updateSettings(...)` and come
  back as `instance.settings` on next launch. List any secret keys in
  `secretSettings` so layout export strips them.
- Shared services live in `$lib/core` (library, toasts, file helpers, network)
  — modules may use those freely.
- Layout (drag, resize, packing, saving) is entirely the dashboard's job;
  modules just fill whatever box they're given.

## Development

```sh
npm run tauri dev      # desktop app, hot reload
npm run dev            # browser only
npm run check          # svelte-check / TypeScript
npm test               # vitest
npm run build          # static frontend into ./build
npm run tauri build    # packaged installer for your OS
```

### Project layout

```
src/lib/core/        registry, event bus, grid maths, workspace + layouts, library, importer, storage, net, markdown, annotations, queue, exporters, settings, zen
src/lib/components/  Dashboard, ModuleFrame, ModulePicker, LayoutMenu, SettingsMenu, DropOverlay, Toasts, Markdown, Editor
src/lib/modules/     one folder per module (search, reader, synthesis, library, annotations, queue, notes, pomodoro, export, debug)
src/lib/sources/     paper-source adapters, merge/rank logic, federated search
src/lib/ai/          LlmProvider interface, Anthropic + OpenAI-compatible providers, SSE parser, prompt builder
src/lib/library/     BibTeX parser, file-type helpers, library search
src-tauri/           Rust shell (plugins, capabilities, window config)
docs/                ideas and design notes
```

### Tests

`npm test` runs ~490 unit tests: parsers (BibTeX, arXiv Atom, SSE), merge and
ranking logic, layout validation and migration, both LLM providers against
mocked streams, the library exporters and the Zotero adapter, and the markdown
sanitiser against common XSS vectors. The
external APIs are exercised only through fixtures, so a real search or model
call is the thing to try after changing an adapter.

### Desktop-shell notes

- File drops use the webview's HTML5 drag-and-drop, so `dragDropEnabled` is
  `false` in `src-tauri/tauri.conf.json`.
- Network requests go through the Tauri HTTP plugin. Allowed hosts are pinned
  in `src-tauri/capabilities/default.json`: all `https://` plus `localhost` /
  `127.0.0.1` over `http` for local model servers and Zotero's local API. A
  model server on another machine needs `https` or an entry added there.
- Saving a file uses the native dialog plus a write to *only the path you
  picked*; there is no general filesystem access.

## Status

Early but usable. Working today: the module system and named layouts;
Semantic Scholar + OpenAlex + arXiv search with merge/filters; the Reader
(open-access, local PDFs, markdown); cited AI briefs from Claude or any
OpenAI-compatible model; a local library with drag-and-drop and BibTeX import;
Zotero search; notes (CodeMirror, optional Vim mode), annotations, a reading
queue, library export (BibTeX / Markdown / JSON), focus mode, pomodoro and
debug modules. Not built yet: chat with a paper, a citation graph, exporting
the stored files, direct DOI / arXiv-id lookup, and a
stricter content-security policy for the webview. Feedback and ideas welcome
via issues.

## License

MIT
