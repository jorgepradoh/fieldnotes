<script lang="ts">
  import { on, emit } from "$lib/core/bus.svelte";
  import { library } from "$lib/core/library.svelte";
  import type { Paper } from "$lib/sources/types";
  import type { ModuleInstance } from "$lib/core/types";

  let {}: { instance: ModuleInstance } = $props();

  let current = $state<Paper | null>(null);

  $effect(() =>
    on("paper:selected", ({ paper }) => {
      current = paper;
    }),
  );

  function authorLine(paper: Paper): string {
    const names = paper.authors.slice(0, 2).join(", ");
    return paper.authors.length > 2 ? `${names} et al.` : names;
  }

  async function importLocalFile(): Promise<void> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path || typeof path !== "string") return;
    const filename = path.split(/[\\/]/).pop() ?? path;
    const title = filename.replace(/\.pdf$/i, "");
    const paper: Paper = {
      id: `local:${path}`,
      source: "local",
      title,
      authors: [],
      year: null,
      venue: null,
      abstract: null,
      tldr: null,
      citationCount: null,
      url: null,
      pdfUrl: `local://${path}`,
      doi: null,
      arxivId: null,
    };
    library.add(paper);
    emit("paper:selected", { paper });
  }
</script>

<div class="library">
  {#if current && !library.has(current.id)}
    <div class="banner">
      <span class="banner-title" title={current.title}>{current.title}</span>
      <button class="save-btn" onclick={() => current && library.add(current)}>+ Save</button>
    </div>
  {/if}

  <div class="import-bar">
    <button class="import-btn" onclick={() => void importLocalFile()}>+ Local PDF</button>
  </div>

  {#if library.loaded && library.entries.length === 0}
    <p class="empty">
      Select a paper in <strong>Paper Search</strong> then click <strong>+ Save</strong>, or
      import a local PDF above.
    </p>
  {:else}
    <ul>
      {#each library.entries as { paper } (paper.id)}
        <li class:active={current?.id === paper.id}>
          <button class="paper" onclick={() => emit("paper:selected", { paper })}>
            <span class="title">{paper.title}</span>
            <span class="meta">
              {authorLine(paper)}{#if paper.year} · {paper.year}{/if}
            </span>
          </button>
          <button
            class="remove"
            onclick={() => library.remove(paper.id)}
            aria-label="Remove from library"
          >×</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .library {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    flex-shrink: 0;
  }

  .banner-title {
    flex: 1;
    min-width: 0;
    font-size: 0.75rem;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .save-btn {
    flex-shrink: 0;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: #0e1018;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.2rem 0.55rem;
    cursor: pointer;
  }

  .import-bar {
    flex-shrink: 0;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .import-btn {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 0.73rem;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    width: 100%;
  }

  .import-btn:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  .empty {
    margin: auto;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.8rem;
    max-width: 85%;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0.4rem;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  li {
    display: flex;
    gap: 0.3rem;
    align-items: flex-start;
  }

  li.active .paper {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  }

  .paper {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.4rem 0.55rem;
    cursor: pointer;
  }

  .paper:hover {
    border-color: var(--accent);
  }

  .title {
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .meta {
    font-size: 0.7rem;
    color: var(--text-dim);
  }

  .remove {
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 1rem;
    line-height: 1;
    padding: 0.3rem 0.4rem;
    cursor: pointer;
    border-radius: 6px;
    margin-top: 0.2rem;
  }

  .remove:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
</style>
