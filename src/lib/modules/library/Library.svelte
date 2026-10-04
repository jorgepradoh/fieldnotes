<script lang="ts">
  import { emit } from "$lib/core/bus.svelte";
  import { pickFiles } from "$lib/core/files";
  import { attachPdfToEntry, importFiles } from "$lib/core/importer";
  import { library } from "$lib/core/library.svelte";
  import type { ModuleInstance } from "$lib/core/types";
  import { workspace } from "$lib/core/workspace.svelte";
  import { SORTS, matchesQuery, sortRows, type LibrarySort } from "$lib/library/query";
  import type { Paper } from "$lib/sources/types";

  let { instance }: { instance: ModuleInstance } = $props();

  const PAGE = 150;

  // Settings hydrate initial state once; edits flow back via updateSettings.
  // svelte-ignore state_referenced_locally
  const initial = instance.settings;
  let filter = $state("");
  let sort = $state<LibrarySort>(SORTS.some((s) => s.id === initial.sort) ? (initial.sort as LibrarySort) : "added");
  let limit = $state(PAGE);
  let selectedId = $state<string | null>(null);
  let confirmId = $state<string | null>(null);

  void library.ensureLoaded();

  const rows = $derived(sortRows(library.entries.filter((e) => matchesQuery(e.paper, filter)), sort));
  const visible = $derived(rows.slice(0, limit));

  $effect(() => {
    void filter;
    void sort;
    limit = PAGE;
  });

  function select(paper: Paper): void {
    selectedId = paper.id;
    emit("paper:selected", { paper });
  }

  async function importPicked(): Promise<void> {
    const files = await pickFiles(".pdf,.md,.markdown,.txt,.bib,.bibtex,.json,application/pdf", true);
    if (files.length > 0) await importFiles(files);
  }

  async function attach(paper: Paper): Promise<void> {
    const [file] = await pickFiles(".pdf,application/pdf");
    if (file) await attachPdfToEntry(paper.id, file);
  }

  async function remove(id: string): Promise<void> {
    confirmId = null;
    await library.remove(id);
  }

  function authorLine(paper: Paper): string {
    const names = paper.authors.slice(0, 3).join(", ");
    return paper.authors.length > 3 ? `${names} et al.` : names;
  }

  const SOURCE_LABEL: Record<string, string> = {
    bibtex: "BibTeX",
    local: "File",
    "semantic-scholar": "S2",
    openalex: "OA",
    arxiv: "arXiv",
  };
</script>

<div class="library">
  <div class="bar">
    <input bind:value={filter} placeholder="Filter your library…" aria-label="Filter library" />
    <select
      bind:value={sort}
      onchange={() => workspace.updateSettings(instance.instanceId, { sort })}
      aria-label="Sort library"
    >
      {#each SORTS as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
    </select>
    <button type="button" class="import" onclick={() => void importPicked()}>Import…</button>
  </div>

  {#if !library.loaded}
    <p class="empty">Loading…</p>
  {:else if library.entries.length === 0}
    <p class="empty">
      Your library is empty. <strong>Drop</strong> PDFs, markdown notes or a <code>.bib</code> file anywhere on the
      window, or use <strong>Import…</strong>. Papers from search can be saved from the Reader.
    </p>
  {:else}
    <p class="count">
      {rows.length === library.entries.length
        ? `${library.entries.length.toLocaleString()} item${library.entries.length === 1 ? "" : "s"}`
        : `${rows.length.toLocaleString()} of ${library.entries.length.toLocaleString()}`}
    </p>
    <ul>
      {#each visible as { paper } (paper.id)}
        <li class:selected={selectedId === paper.id}>
          <button type="button" class="row" onclick={() => select(paper)}>
            <span class="title">{paper.title}</span>
            <span class="meta">
              {authorLine(paper)}
              {#if paper.year}· {paper.year}{/if}
              {#if paper.venue}· {paper.venue}{/if}
            </span>
            <span class="badges">
              <span class="badge">{SOURCE_LABEL[paper.source] ?? paper.source}</span>
              {#if paper.localFile?.kind === "pdf"}<span class="badge file">PDF file</span>
              {:else if paper.localFile?.kind === "markdown"}<span class="badge file">Markdown</span>
              {:else if paper.pdfUrl}<span class="badge online">PDF online</span>{/if}
              {#if paper.citekey}<span class="badge cite">{paper.citekey}</span>{/if}
            </span>
          </button>
          <span class="actions">
            {#if confirmId === paper.id}
              <button type="button" class="danger" onclick={() => void remove(paper.id)}>Remove</button>
              <button type="button" onclick={() => (confirmId = null)}>Keep</button>
            {:else}
              {#if paper.localFile?.kind !== "pdf" && paper.localFile?.kind !== "markdown"}
                <button type="button" title="Attach a PDF file" aria-label="Attach a PDF to {paper.title}" onclick={() => void attach(paper)}>＋PDF</button>
              {/if}
              <button type="button" title="Remove from library" aria-label="Remove {paper.title}" onclick={() => (confirmId = paper.id)}>✕</button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
    {#if visible.length < rows.length}
      <button type="button" class="more" onclick={() => (limit += PAGE)}>
        Show {Math.min(PAGE, rows.length - visible.length)} more
      </button>
    {:else if rows.length === 0}
      <p class="empty">Nothing matches “{filter}”.</p>
    {/if}
  {/if}
</div>

<style>
  .library {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 0.6rem;
    gap: 0.5rem;
    min-height: 0;
  }

  .bar {
    display: flex;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  input,
  select {
    min-width: 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 0.4rem 0.55rem;
    font-size: 0.8rem;
    outline: none;
  }

  .bar input {
    flex: 1;
  }

  input:focus,
  select:focus {
    border-color: var(--accent);
  }

  button {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 0.78rem;
    cursor: pointer;
  }

  button:hover {
    border-color: var(--accent);
  }

  .import {
    background: var(--accent);
    border-color: var(--accent);
    color: #0e1018;
    font-weight: 600;
    padding: 0.35rem 0.7rem;
  }

  .count {
    margin: 0;
    flex-shrink: 0;
    font-size: 0.7rem;
    color: var(--text-dim);
  }

  .empty {
    margin: auto;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.8rem;
    line-height: 1.5;
    max-width: 92%;
  }

  code {
    background: var(--surface-2);
    padding: 0.1em 0.3em;
    border-radius: 4px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-height: 0;
  }

  li {
    position: relative;
    display: flex;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  li:hover,
  li.selected {
    border-color: var(--accent);
  }

  li.selected {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  }

  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    text-align: left;
    background: none;
    border: none;
    padding: 0.45rem 0.6rem;
  }

  .title {
    font-size: 0.82rem;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .meta {
    font-size: 0.72rem;
    color: var(--text-dim);
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .badge {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 0.05rem 0.3rem;
  }

  .badge.file {
    color: #9ece6a;
    border-color: color-mix(in srgb, #9ece6a 40%, transparent);
  }

  .badge.online {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .badge.cite {
    text-transform: none;
    letter-spacing: 0;
  }

  .actions {
    display: flex;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 0.35rem 0.35rem 0 0;
    opacity: 0;
    transition: opacity 0.1s;
  }

  li:hover .actions,
  li:focus-within .actions {
    opacity: 1;
  }

  .actions button {
    padding: 0.15rem 0.4rem;
    font-size: 0.7rem;
    color: var(--text-dim);
  }

  .actions button.danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 50%, transparent);
  }

  .more {
    flex-shrink: 0;
    padding: 0.35rem;
  }
</style>
