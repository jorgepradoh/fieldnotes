# fieldnotes — notes for Claude Code sessions

Local-first desktop research app: Tauri 2 (Rust shell) + SvelteKit 2 / Svelte 5 (runes) + TypeScript strict.
README.md is the user-facing doc and the module contract; `docs/plans/` holds the plans; `docs/IDEAS.md` is the parking lot.

## Commands
- `npm run check` — svelte-check, must stay **0 errors and 0 warnings**
- `npm test` — vitest (colocated `*.test.ts`); `npm run build` — static frontend into `build/`
- `npm run dev` — browser only (localStorage instead of the Tauri store; arXiv is blocked by CORS there)
- `npm run check:tauri-parity` — npm `@tauri-apps/*` and Rust `tauri*` crates must share a minor (needs Node ≥ 22.6)
- Run check + test before every commit. CI runs these plus build, `npm audit --omit=dev --audit-level=high`, parity.

## Architecture rules
- A module is `src/lib/modules/<id>/` exporting a `ModuleDefinition`, registered in `modules/index.ts`.
  **Modules never import each other**; they talk over the typed bus (`core/bus.svelte.ts`, add events to `BusEvents`).
  They may use `core/` stores (library, toasts, files, net).
- Logic lives in pure plain-`.ts` modules (`library/`, `sources/`, `ai/`, `core/*.ts`) with tests; components stay thin.
  There are no component tests. Stores are tested by mocking `./storage` (see `library.test.ts`).
- Persistence goes through `core/storage.ts` (`loadJson`/`saveJson`): Tauri store files in app-data, `localStorage` in a browser.
- The library entry is the record for a paper: status, tags and notes are keyed by its `paper.id`; find a paper with
  `library.find(paper)` / `library.idFor(paper)`, never by raw id.

## Guardrails
1. Untrusted text (LLM output, paper text, dropped files, notes) only goes through `core/markdown.ts`.
   `{@html}` exists in exactly one place, `components/Markdown.svelte`. Never add another sink.
2. No Rust, Tauri plugin, `Cargo.*` or `tauri.conf.json` changes unless the task says so. File access stays
   scoped to the dialog + `saveTextFile`/`pickFiles` in `core/files.ts`.
3. Secrets (API keys, emails) are declared in a module's `secretSettings` or live in `ai.json`; never in exports or logs.
4. Network only through `httpFetch`/`fetchWithRetry` (`core/net.ts`); handle 429s with the existing retry.
5. LLM calls only on an explicit user action; anything sending a paper's full text off the device asks first.
6. Do not touch Tauri package versions; no `npm update` / `cargo update`.
7. Data changes are additive, migrated and tested: never drop unknown fields; migrations are pure functions with
   tests built from real-shaped fixtures; every old format keeps loading. Never delete a user's old files.
8. No new dependency unless the task names it. No new `any`, no `console.log`. UI text is English; use the CSS variables.

## Persisted files (do not break)
`layouts.json` v2 · `library.json` v2 (entries with status/tags/note; also reads v1 and the June bare list) ·
IndexedDB blobs · `ai.json` (API keys live here only) · `settings.json` · `workspace.json` (legacy, read-only) ·
`queue.json` / `annotations.json` (legacy, read once by the library migration, never written).

## Working style
State assumptions; if a request has two plausible readings say so. Simplicity first, surgical changes: every changed
line traces to the task. Turn each task into something verifiable. Each new guard gets a test that fails without it.

## In a cloud session you cannot
Launch the Tauri shell or `cargo check` (no webkit2gtk), reach the live paper APIs, or call a model without a key.
Test with mocks and fixtures, drive the UI in Chromium (Playwright is preinstalled), and list everything else under
"Not verified" in the PR. Never claim the desktop window, a live API or a real model call was exercised if it wasn't.
