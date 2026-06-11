<script lang="ts">
  import { emit } from "$lib/core/bus.svelte";
  import type { ModuleInstance } from "$lib/core/types";

  // Module contract: every module receives its instance, unused here.
  let {}: { instance: ModuleInstance } = $props();

  interface StubPaper {
    paperId: string;
    title: string;
    year: number;
    citations: number;
  }

  const CANNED: StubPaper[] = [
    { paperId: "stub-1", title: "Attention Is All You Need", year: 2017, citations: 130412 },
    { paperId: "stub-2", title: "Deep Residual Learning for Image Recognition", year: 2016, citations: 224870 },
    { paperId: "stub-3", title: "Language Models are Few-Shot Learners", year: 2020, citations: 38215 },
    { paperId: "stub-4", title: "Denoising Diffusion Probabilistic Models", year: 2020, citations: 21043 },
  ];

  let query = $state("");
  let results = $state<StubPaper[]>([]);
  let selectedId = $state<string | null>(null);

  function search(e: SubmitEvent): void {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    emit("search:query", { query: q });
    results = CANNED;
  }

  function select(paper: StubPaper): void {
    selectedId = paper.paperId;
    emit("paper:selected", { paperId: paper.paperId, title: paper.title });
  }
</script>

<div class="search">
  <form onsubmit={search}>
    <input bind:value={query} placeholder="Search a field, keyword, topic…" />
    <button type="submit">Search</button>
  </form>

  {#if results.length > 0}
    <p class="stub-note">Stubbed results — real Semantic Scholar search is the next milestone.</p>
    <ul>
      {#each results as paper (paper.paperId)}
        <li>
          <button class:selected={selectedId === paper.paperId} onclick={() => select(paper)}>
            <span class="title">{paper.title}</span>
            <span class="meta">{paper.year} · {paper.citations.toLocaleString()} citations</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">Search to see results. Selecting a paper emits <code>paper:selected</code> on the bus.</p>
  {/if}
</div>

<style>
  .search {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 0.6rem;
    gap: 0.5rem;
  }

  form {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  input {
    flex: 1;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  form button {
    background: var(--accent);
    color: #0e1018;
    border: none;
    border-radius: 8px;
    padding: 0.4rem 0.8rem;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .stub-note {
    margin: 0;
    font-size: 0.7rem;
    color: var(--text-dim);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  li button {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    width: 100%;
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.45rem 0.6rem;
    cursor: pointer;
  }

  li button:hover {
    border-color: var(--accent);
  }

  li button.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  }

  .title {
    font-size: 0.82rem;
    font-weight: 600;
  }

  .meta {
    font-size: 0.72rem;
    color: var(--text-dim);
  }

  .empty {
    margin: auto;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.8rem;
    max-width: 90%;
  }

  code {
    background: var(--surface-2);
    padding: 0.1em 0.3em;
    border-radius: 4px;
  }
</style>
