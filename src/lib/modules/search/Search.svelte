<script lang="ts">
  import { emit } from "$lib/core/bus.svelte";
  import { workspace } from "$lib/core/workspace.svelte";
  import { semanticScholar } from "$lib/sources/semanticScholar";
  import type { Paper } from "$lib/sources/types";
  import type { ModuleInstance } from "$lib/core/types";

  let { instance }: { instance: ModuleInstance } = $props();

  const PAGE = 20;

  // Settings hydrate initial state once; edits flow back via updateSettings.
  // svelte-ignore state_referenced_locally
  const initial = instance.settings;
  let query = $state(String(initial.query ?? ""));
  let apiKey = $state(String(initial.apiKey ?? ""));

  let showSettings = $state(false);
  let papers = $state<Paper[]>([]);
  let total = $state(0);
  let nextOffset = $state<number | null>(null);
  let status = $state<"idle" | "searching" | "paging" | "error">("idle");
  let error = $state("");
  let selectedId = $state<string | null>(null);
  let searched = $state(false);

  let controller: AbortController | null = null;

  async function run(offset: number): Promise<void> {
    controller?.abort();
    controller = new AbortController();
    status = offset === 0 ? "searching" : "paging";
    error = "";
    try {
      const result = await semanticScholar.search(
        { query: query.trim(), limit: PAGE, offset },
        { signal: controller.signal, apiKey: apiKey.trim() || undefined },
      );
      papers = offset === 0 ? result.papers : [...papers, ...result.papers];
      total = result.total;
      nextOffset = result.nextOffset;
      status = "idle";
      searched = true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      status = "error";
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function search(e: SubmitEvent): void {
    e.preventDefault();
    const q = query.trim();
    if (!q || status === "searching") return;
    workspace.updateSettings(instance.instanceId, { query: q });
    emit("search:query", { query: q });
    void run(0);
  }

  function select(paper: Paper): void {
    selectedId = paper.id;
    emit("paper:selected", { paper });
  }

  function saveKey(): void {
    workspace.updateSettings(instance.instanceId, { apiKey: apiKey.trim() });
  }

  async function openExternal(url: string): Promise<void> {
    if ("__TAURI_INTERNALS__" in window) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } else {
      window.open(url, "_blank");
    }
  }

  function authorLine(paper: Paper): string {
    const names = paper.authors.slice(0, 3).join(", ");
    return paper.authors.length > 3 ? `${names} et al.` : names;
  }
</script>

<div class="search">
  <form onsubmit={search}>
    <input bind:value={query} placeholder="Search a field, keyword, topic…" />
    <button type="submit" class="go" disabled={status === "searching"}>
      {status === "searching" ? "…" : "Search"}
    </button>
    <button
      type="button"
      class="gear"
      class:on={showSettings}
      onclick={() => (showSettings = !showSettings)}
      aria-label="Search settings"
      title="Settings"
    >
      ⚙
    </button>
  </form>

  {#if showSettings}
    <div class="settings">
      <label>
        Semantic Scholar API key <small>(optional — lifts the shared rate limit)</small>
        <input type="password" bind:value={apiKey} onchange={saveKey} placeholder="none" />
      </label>
    </div>
  {/if}

  {#if status === "error"}
    <p class="error">{error}</p>
  {/if}

  {#if papers.length > 0}
    <p class="count">{total.toLocaleString()} results · Semantic Scholar</p>
    <ul>
      {#each papers as paper (paper.id)}
        <li>
          <button class:selected={selectedId === paper.id} onclick={() => select(paper)}>
            <span class="title">{paper.title}</span>
            <span class="meta">
              {authorLine(paper)}
              {#if paper.year}· {paper.year}{/if}
              {#if paper.venue}· {paper.venue}{/if}
              {#if paper.citationCount != null}· {paper.citationCount.toLocaleString()} citations{/if}
            </span>
            {#if paper.tldr}
              <span class="tldr">{paper.tldr}</span>
            {/if}
            <span class="badges">
              {#if paper.pdfUrl}<span class="badge pdf">PDF</span>{/if}
              {#if paper.arxivId}<span class="badge">arXiv</span>{/if}
              {#if paper.url}
                <!-- svelte-ignore node_invalid_placement_ssr -->
                <span
                  class="badge link"
                  role="link"
                  tabindex="0"
                  onclick={(e) => {
                    e.stopPropagation();
                    if (paper.url) void openExternal(paper.url);
                  }}
                  onkeydown={(e) => {
                    if (e.key === "Enter" && paper.url) {
                      e.stopPropagation();
                      void openExternal(paper.url);
                    }
                  }}
                >
                  open ↗
                </span>
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if nextOffset != null}
      <button class="more" onclick={() => void run(nextOffset ?? 0)} disabled={status === "paging"}>
        {status === "paging" ? "Loading…" : "Load more"}
      </button>
    {/if}
  {:else if status === "searching"}
    <p class="empty">Searching Semantic Scholar…</p>
  {:else if searched && status === "idle"}
    <p class="empty">No results for that query.</p>
  {:else if status !== "error"}
    <p class="empty">
      Search 200M+ papers. Selecting one emits <code>paper:selected</code> for other modules.
    </p>
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
    min-width: 0;
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

  .go {
    background: var(--accent);
    color: #0e1018;
    border: none;
    border-radius: 8px;
    padding: 0.4rem 0.8rem;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .go:disabled {
    opacity: 0.6;
  }

  .gear {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-dim);
    padding: 0.4rem 0.55rem;
    cursor: pointer;
  }

  .gear.on {
    border-color: var(--accent);
    color: var(--text);
  }

  .settings {
    flex-shrink: 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.6rem;
  }

  .settings label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .settings input {
    background: var(--surface);
  }

  .error {
    margin: 0;
    flex-shrink: 0;
    color: var(--danger);
    font-size: 0.78rem;
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    border-radius: 8px;
    padding: 0.45rem 0.6rem;
  }

  .count {
    margin: 0;
    flex-shrink: 0;
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
    gap: 0.2rem;
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
    line-height: 1.3;
  }

  .meta {
    font-size: 0.72rem;
    color: var(--text-dim);
  }

  .tldr {
    font-size: 0.74rem;
    color: var(--text-dim);
    font-style: italic;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .badges {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.1rem;
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

  .badge.pdf {
    color: #9ece6a;
    border-color: color-mix(in srgb, #9ece6a 40%, transparent);
  }

  .badge.link {
    cursor: pointer;
  }

  .badge.link:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .more {
    flex-shrink: 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 0.35rem;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .more:hover:not(:disabled) {
    border-color: var(--accent);
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
