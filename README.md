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

1. **Module system** — registry, dashboard grid, layout persistence *(current)*
2. Search + results browser modules (Semantic Scholar first)
3. Reader module (PDF + markdown)
4. AI synthesis module — "state of the field" briefs from top-N results
5. Chat-with-paper, citation graph, community modules

## Development

Prerequisites: [Node](https://nodejs.org) ≥ 20, [Rust](https://rustup.rs), and
on macOS the Xcode Command Line Tools.

```sh
npm install
npm run tauri dev
```

## Status

Early scaffold — nothing usable yet. Feedback and ideas welcome via issues.
