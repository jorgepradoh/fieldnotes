<script lang="ts">
  import { emit } from "$lib/core/bus.svelte";
  import { pickFiles } from "$lib/core/files";
  import { attachPdfToEntry, importFiles } from "$lib/core/importer";
  import { library } from "$lib/core/library.svelte";
  import { toast } from "$lib/core/toast.svelte";
  import type { ModuleInstance } from "$lib/core/types";
  import { workspace } from "$lib/core/workspace.svelte";
  import { MAX_TAGS, STATUSES, isStatus } from "$lib/library/model";
  import { STATUS_LABEL } from "$lib/library/queue";
  import { SORTS, matchesEntry, sortRows, type LibrarySort, type StatusFilter } from "$lib/library/query";
  import type { Paper } from "$lib/sources/types";

  let { instance }: { instance: ModuleInstance } = $props();

  const PAGE = 150;

  // Settings hydrate initial state once; edits flow back via updateSettings.
  // svelte-ignore state_referenced_locally
  const initial = instance.settings;
  let filter = $state("");
  let sort = $state<LibrarySort>(SORTS.some((s) => s.id === initial.sort) ? (initial.sort as LibrarySort) : "added");
  let statusFilter = $state<StatusFilter>("all");
  let tagFilter = $state<string | null>(null);
  let limit = $state(PAGE);
  let selectedId = $state<string | null>(null);
  let confirmId = $state<string | null>(null);

  void library.ensureLoaded();

  const tagList = $derived(library.tags());
  const rows = $derived(
    sortRows(library.entries.filter((e) => matchesEntry(e, { query: filter, status: statusFilter, tag: tagFilter })), sort),
  );
  const visible = $derived(rows.slice(0, limit));

  $effect(() => {
    void filter;
    void sort;
    void statusFilter;
    void tagFilter;
    limit = PAGE;
  });

  // Removing the last paper's tag must not leave the list filtered by a tag that no longer exists.
  $effect(() => {
    if (tagFilter !== null && !tagList.some((t) => t.tag === tagFilter)) tagFilter = null;
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

  function setStatus(id: string, value: string): void {
    library.setStatus(id, isStatus(value) ? value : null);
  }

  /** Adds each comma-separated tag in the box; tells the user if a paper has reached its limit. */
  function addTags(id: string, input: HTMLInputElement): void {
    const results = input.value.split(/[,;]/).map((raw) => library.addTag(id, raw));
    input.value = "";
    if (results.includes("full")) toast(`A paper can have at most ${MAX_TAGS} tags.`, "info");
  }

  function tagKey(e: KeyboardEvent, id: string): void {
    // The Enter that confirms an IME candidate (keyCode 229 in browsers that do not set isComposing)
    // belongs to the composition, not to the tag box.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTags(id, e.currentTarget as HTMLInputElement);
    }
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
  {#if library.entries.length > 0}
    <div class="bar filters">
      <select bind:value={statusFilter} aria-label="Filter by reading status">
        <option value="all">Any status</option>
        <option value="none">Not queued</option>
        {#each STATUSES as st (st)}<option value={st}>{STATUS_LABEL[st]}</option>{/each}
      </select>
      {#if tagList.length > 0}
        <select bind:value={tagFilter} aria-label="Filter by tag">
          <option value={null}>Any tag</option>
          {#each tagList as { tag, count } (tag)}<option value={tag}>{tag} ({count})</option>{/each}
        </select>
      {/if}
    </div>
  {/if}

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
      {#each visible as entry (entry.paper.id)}
        {@const paper = entry.paper}
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
              {#if entry.note}<span class="badge note" title="Has a note">note</span>{/if}
            </span>
          </button>
          <span class="actions">
            {#if confirmId === paper.id}
              <button
                type="button"
                class="danger"
                title="Removes the paper, its tags and its reading status. A note is kept and comes back if you save the paper again."
                onclick={() => void remove(paper.id)}>Remove</button>
              <button type="button" onclick={() => (confirmId = null)}>Keep</button>
            {:else}
              {#if paper.localFile?.kind !== "pdf" && paper.localFile?.kind !== "markdown"}
                <button type="button" title="Attach a PDF file" aria-label="Attach a PDF to {paper.title}" onclick={() => void attach(paper)}>＋PDF</button>
              {/if}
              <button type="button" title="Remove from library" aria-label="Remove {paper.title}" onclick={() => (confirmId = paper.id)}>✕</button>
            {/if}
          </span>
          <div class="organize">
            <select
              class="status"
              value={entry.status ?? ""}
              onchange={(e) => setStatus(paper.id, e.currentTarget.value)}
              aria-label="Reading status of {paper.title}"
            >
              <option value="">Not queued</option>
              {#each STATUSES as st (st)}<option value={st}>{STATUS_LABEL[st]}</option>{/each}
            </select>
            {#each entry.tags ?? [] as tag (tag)}
              <span class="tag">
                {tag}<button type="button" aria-label="Remove tag {tag} from {paper.title}" onclick={() => library.removeTag(paper.id, tag)}>×</button>
              </span>
            {/each}
            <input
              class="tag-input"
              placeholder="＋ tag"
              aria-label="Add a tag to {paper.title}"
              onkeydown={(e) => tagKey(e, paper.id)}
              onblur={(e) => e.currentTarget.value.trim() && addTags(paper.id, e.currentTarget)}
            />
          </div>
        </li>
      {/each}
    </ul>
    {#if visible.length < rows.length}
      <button type="button" class="more" onclick={() => (limit += PAGE)}>
        Show {Math.min(PAGE, rows.length - visible.length)} more
      </button>
    {:else if rows.length === 0}
      <p class="empty">{filter.trim() ? `Nothing matches “${filter}”.` : "Nothing matches these filters."}</p>
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
    flex-wrap: wrap;
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

  .badge.note {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .organize {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0.6rem 0.45rem;
  }

  .organize .status {
    padding: 0.1rem 0.3rem;
    font-size: 0.68rem;
    border-radius: 6px;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    font-size: 0.68rem;
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-radius: 10px;
    padding: 0.05rem 0.15rem 0.05rem 0.5rem;
  }

  .tag button {
    border: none;
    background: none;
    color: var(--text-dim);
    padding: 0 0.3rem;
    font-size: 0.8rem;
    line-height: 1;
  }

  .tag button:hover {
    color: var(--danger);
  }

  .tag-input {
    width: 4.5rem;
    padding: 0.1rem 0.4rem;
    font-size: 0.68rem;
    border-radius: 10px;
    transition: width 0.15s;
  }

  .tag-input:focus {
    width: 9rem;
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
