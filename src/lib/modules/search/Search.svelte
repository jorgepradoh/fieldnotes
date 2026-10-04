<script lang="ts">
  import { untrack } from "svelte";
  import { emit } from "$lib/core/bus.svelte";
  import { isAbortError, openExternal } from "$lib/core/net";
  import type { ModuleInstance } from "$lib/core/types";
  import { workspace } from "$lib/core/workspace.svelte";
  import {
    allFailed,
    failures,
    fetchNextPage,
    hasMore,
    visiblePapers,
    type Batches,
    type SourceConfig,
  } from "$lib/sources/federated";
  import { hasActiveFilters } from "$lib/sources/merge";
  import { DEFAULT_SOURCE_IDS, SOURCES, getSource, sourceLabel } from "$lib/sources";
  import type { Paper, SearchFilters, SortMode } from "$lib/sources/types";

  let { instance }: { instance: ModuleInstance } = $props();

  const PAGE = 20;
  const HISTORY_LIMIT = 12;
  const SORTS: { id: SortMode; label: string }[] = [
    { id: "relevance", label: "Relevance" },
    { id: "citations", label: "Most cited" },
    { id: "newest", label: "Newest" },
  ];

  // Settings hydrate initial state once; edits flow back via updateSettings.
  // svelte-ignore state_referenced_locally
  const initial = instance.settings;
  let query = $state(String(initial.query ?? ""));
  let enabled = $state<string[]>(
    Array.isArray(initial.sources)
      ? (initial.sources as string[]).filter((id) => getSource(id))
      : [...DEFAULT_SOURCE_IDS],
  );
  let filters = $state<SearchFilters>({ ...((initial.filters as SearchFilters | undefined) ?? {}) });
  let sort = $state<SortMode>(
    SORTS.some((s) => s.id === initial.sort) ? (initial.sort as SortMode) : "relevance",
  );
  let history = $state<string[]>(Array.isArray(initial.history) ? (initial.history as string[]) : []);
  // `apiKey` is the Semantic Scholar key — the name predates multiple sources.
  let apiKey = $state(String(initial.apiKey ?? ""));
  let openAlexKey = $state(String(initial.openAlexKey ?? ""));
  let email = $state(String(initial.email ?? ""));

  let showSettings = $state(false);
  let showFilters = $state(false);
  let status = $state<"idle" | "searching" | "paging">("idle");
  let searched = $state(false);
  let selectedId = $state<string | null>(null);
  let fatal = $state("");
  /** The query the current results belong to (the input box may have moved on). */
  let activeQuery = $state("");
  // Replaced wholesale, never mutated: no need for deep proxies.
  let batches = $state.raw<Batches | null>(null);

  let controller: AbortController | null = null;

  const order = $derived(SOURCES.map((s) => s.id).filter((id) => enabled.includes(id)));
  const papers = $derived(batches ? visiblePapers(batches, order, filters, sort) : []);
  const problems = $derived(batches ? failures(batches).filter((f) => enabled.includes(f.id)) : []);
  const activeFilterCount = $derived(
    (filters.yearFrom != null || filters.yearTo != null ? 1 : 0) +
      ((filters.minCitations ?? 0) > 0 ? 1 : 0) +
      (filters.openAccessOnly ? 1 : 0),
  );
  const moreAvailable = $derived(
    !!batches && SOURCES.some((s) => enabled.includes(s.id) && (batches?.[s.id]?.next ?? null) !== null),
  );

  // Other modules (the AI synthesis panel) work from what is currently shown.
  $effect(() => {
    const list = papers;
    const q = activeQuery;
    if (!searched) return;
    untrack(() => emit("search:results", { query: q, papers: list }));
  });

  function persist(patch: Record<string, unknown>): void {
    workspace.updateSettings(instance.instanceId, patch);
  }

  function configFor(id: string): SourceConfig | null {
    const source = getSource(id);
    if (!source) return null;
    const opts =
      id === "semantic-scholar"
        ? { apiKey: apiKey.trim() || undefined }
        : id === "openalex"
          ? { apiKey: openAlexKey.trim() || undefined, email: email.trim() || undefined }
          : {};
    return { source, opts };
  }

  function configs(ids: string[]): SourceConfig[] {
    return ids.map(configFor).filter((c): c is SourceConfig => c !== null);
  }

  function normalizedFilters(): SearchFilters {
    const num = (v: unknown): number | undefined => {
      const n = typeof v === "number" ? v : Number.NaN;
      return Number.isFinite(n) ? Math.round(n) : undefined;
    };
    const next: SearchFilters = {
      yearFrom: num(filters.yearFrom),
      yearTo: num(filters.yearTo),
      minCitations: num(filters.minCitations),
      openAccessOnly: filters.openAccessOnly || undefined,
    };
    if (next.yearFrom != null && next.yearTo != null && next.yearFrom > next.yearTo) {
      [next.yearFrom, next.yearTo] = [next.yearTo, next.yearFrom];
    }
    return next;
  }

  /**
   * fresh: new search of every enabled source. Otherwise fetch `only` (retry or
   * a newly enabled source) or, by default, the next page of every source
   * that has one.
   */
  async function run(fresh: boolean, only?: string[]): Promise<void> {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;

    const ids = only ?? order;
    if (ids.length === 0) {
      fatal = "Turn on at least one source.";
      return;
    }
    fatal = "";
    status = fresh ? "searching" : "paging";
    if (fresh) activeQuery = query.trim();

    try {
      const next = await fetchNextPage(
        configs(ids),
        { query: activeQuery, limit: PAGE, filters: normalizedFilters(), sort, signal: mine.signal },
        fresh ? null : batches,
      );
      if (mine.signal.aborted) return;
      batches = fresh ? next : { ...batches, ...next };
      searched = true;
      status = "idle";
    } catch (err) {
      if (isAbortError(err)) return;
      status = "idle";
      fatal = err instanceof Error ? err.message : String(err);
    }
  }

  function submit(e: SubmitEvent): void {
    e.preventDefault();
    const q = query.trim();
    if (!q || status === "searching") return;
    history = [q, ...history.filter((h) => h !== q)].slice(0, HISTORY_LIMIT);
    persist({ query: q, history });
    emit("search:query", { query: q });
    void run(true);
  }

  /** Server-side filters and sort change which papers come back, so re-query. */
  function criteriaChanged(): void {
    filters = normalizedFilters();
    persist({ filters: $state.snapshot(filters), sort });
    if (searched && activeQuery) void run(true);
  }

  function toggleSource(id: string): void {
    const turningOn = !enabled.includes(id);
    enabled = turningOn ? [...enabled, id] : enabled.filter((s) => s !== id);
    persist({ sources: $state.snapshot(enabled) });
    // A source switched on after the search has nothing yet: fetch just it.
    if (turningOn && searched && activeQuery && !batches?.[id]) void run(false, [id]);
  }

  function resetFilters(): void {
    filters = {};
    criteriaChanged();
  }

  function select(paper: Paper): void {
    selectedId = paper.id;
    emit("paper:selected", { paper });
  }

  function authorLine(paper: Paper): string {
    const names = paper.authors.slice(0, 3).join(", ");
    return paper.authors.length > 3 ? `${names} et al.` : names;
  }

  function summary(): string {
    if (!batches) return "";
    return order
      .map((id) => {
        const b = batches?.[id];
        if (!b) return null;
        return b.error ? `${sourceLabel(id)} ⚠` : `${sourceLabel(id)} ${b.total.toLocaleString()}`;
      })
      .filter(Boolean)
      .join(" · ");
  }
</script>

<div class="search">
  <form onsubmit={submit}>
    <input
      bind:value={query}
      list={`history-${instance.instanceId}`}
      placeholder="Search a field, keyword, topic…"
      aria-label="Search query"
    />
    <datalist id={`history-${instance.instanceId}`}>
      {#each history as h (h)}<option value={h}></option>{/each}
    </datalist>
    <button type="submit" class="go" disabled={status === "searching"}>
      {status === "searching" ? "…" : "Search"}
    </button>
    <button
      type="button"
      class="gear"
      class:on={showSettings}
      onclick={() => (showSettings = !showSettings)}
      aria-label="Search settings"
      title="Keys and contact email"
    >
      ⚙
    </button>
  </form>

  <div class="controls">
    {#each SOURCES as src (src.id)}
      {@const batch = batches?.[src.id]}
      <button
        type="button"
        class="chip"
        class:on={enabled.includes(src.id)}
        class:bad={enabled.includes(src.id) && !!batch?.error}
        onclick={() => toggleSource(src.id)}
        aria-pressed={enabled.includes(src.id)}
        title={batch?.error ? `${src.name}: ${batch.error}` : `Include ${src.name}`}
      >
        {src.shortName}{#if batch && enabled.includes(src.id)}
          <span class="n">{batch.error ? "⚠" : batch.papers.length}</span>
        {/if}
      </button>
    {/each}
    <span class="grow"></span>
    <button
      type="button"
      class="chip"
      class:on={showFilters || activeFilterCount > 0}
      onclick={() => (showFilters = !showFilters)}
      aria-expanded={showFilters}
    >
      Filters{#if activeFilterCount > 0}<span class="n">{activeFilterCount}</span>{/if}
    </button>
    <select
      bind:value={sort}
      onchange={criteriaChanged}
      aria-label="Sort results"
      title="Sort results"
    >
      {#each SORTS as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
    </select>
  </div>

  {#if showFilters}
    <div class="panel">
      <div class="row">
        <label>
          From year
          <input type="number" min="1800" max="2100" placeholder="any" bind:value={filters.yearFrom} onchange={criteriaChanged} />
        </label>
        <label>
          To year
          <input type="number" min="1800" max="2100" placeholder="any" bind:value={filters.yearTo} onchange={criteriaChanged} />
        </label>
        <label>
          Min citations
          <input type="number" min="0" placeholder="0" bind:value={filters.minCitations} onchange={criteriaChanged} />
        </label>
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={filters.openAccessOnly} onchange={criteriaChanged} />
        Only papers with an open-access PDF
      </label>
      <div class="row foot">
        <small>arXiv has no citation counts, so it drops out when a citation minimum is set.</small>
        {#if hasActiveFilters(filters)}
          <button type="button" class="link" onclick={resetFilters}>Reset</button>
        {/if}
      </div>
    </div>
  {/if}

  {#if showSettings}
    <div class="panel">
      <label>
        Semantic Scholar API key <small>(optional — lifts the shared rate limit)</small>
        <input
          type="password"
          bind:value={apiKey}
          onchange={() => persist({ apiKey: apiKey.trim() })}
          placeholder="none"
          autocomplete="off"
        />
      </label>
      <label>
        OpenAlex email <small>(optional — faster "polite pool")</small>
        <input
          type="email"
          bind:value={email}
          onchange={() => persist({ email: email.trim() })}
          placeholder="you@example.org"
          autocomplete="off"
        />
      </label>
      <label>
        OpenAlex API key <small>(optional)</small>
        <input
          type="password"
          bind:value={openAlexKey}
          onchange={() => persist({ openAlexKey: openAlexKey.trim() })}
          placeholder="none"
          autocomplete="off"
        />
      </label>
      <small class="fine">Stored on this machine only and never included in layout exports.</small>
    </div>
  {/if}

  {#if fatal}
    <p class="error">{fatal}</p>
  {/if}

  {#if problems.length > 0 && batches}
    <div class="error">
      {#each problems as p (p.id)}
        <div><strong>{sourceLabel(p.id)}:</strong> {p.message}</div>
      {/each}
      <button type="button" class="link" onclick={() => void run(false, problems.map((p) => p.id))}>
        Retry{problems.length > 1 ? " failed sources" : ""}
      </button>
      {#if !allFailed(batches)}<span class="dim"> · showing the other sources</span>{/if}
    </div>
  {/if}

  {#if papers.length > 0}
    <p class="count">{papers.length} papers · {summary()}</p>
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
              {#each paper.sources ?? [paper.source] as s (s)}
                <span class="badge">{sourceLabel(s)}</span>
              {/each}
              {#if paper.pdfUrl}<span class="badge pdf">PDF</span>{/if}
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
    {#if moreAvailable}
      <button class="more" onclick={() => void run(false)} disabled={status === "paging"}>
        {status === "paging" ? "Loading…" : "Load more"}
      </button>
    {/if}
  {:else if status === "searching"}
    <p class="empty">Searching {order.map(sourceLabel).join(", ")}…</p>
  {:else if searched && problems.length === 0 && hasMore(batches ?? {}) && activeFilterCount > 0}
    <p class="empty">Nothing on this page matches your filters yet.</p>
    <button class="more" onclick={() => void run(false)} disabled={status === "paging"}>Load more</button>
  {:else if searched && problems.length === 0}
    <p class="empty">
      No results for that query{activeFilterCount > 0 ? " with these filters. Try loosening them" : ""}.
    </p>
  {:else if !searched && !fatal}
    <p class="empty">
      Search Semantic Scholar, OpenAlex and arXiv together. Selecting a paper emits
      <code>paper:selected</code> for other modules.
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
    min-height: 0;
  }

  form {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  input,
  select {
    min-width: 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    outline: none;
  }

  form input {
    flex: 1;
  }

  input:focus,
  select:focus {
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

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .grow {
    flex: 1;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-dim);
    padding: 0.15rem 0.6rem;
    font-size: 0.74rem;
    cursor: pointer;
  }

  .chip.on {
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .chip.bad {
    border-color: color-mix(in srgb, var(--danger) 60%, var(--border));
  }

  .chip .n {
    font-size: 0.68rem;
    color: var(--text-dim);
  }

  .chip.bad .n {
    color: var(--danger);
  }

  .controls select {
    padding: 0.15rem 0.4rem;
    font-size: 0.74rem;
    border-radius: 999px;
  }

  .panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.5rem 0.6rem;
  }

  .panel .row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }

  .panel .row label {
    flex: 1;
  }

  .panel label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.73rem;
    color: var(--text-dim);
  }

  .panel input {
    background: var(--surface);
  }

  .panel label.check {
    flex-direction: row;
    align-items: center;
    gap: 0.4rem;
  }

  .panel .foot {
    justify-content: space-between;
    align-items: center;
  }

  .fine,
  .panel small {
    color: var(--text-dim);
    font-size: 0.68rem;
  }

  .link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    font-size: inherit;
  }

  .error {
    margin: 0;
    flex-shrink: 0;
    color: var(--danger);
    font-size: 0.78rem;
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    border-radius: 8px;
    padding: 0.45rem 0.6rem;
    line-height: 1.4;
  }

  .error .dim {
    color: var(--text-dim);
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
    min-height: 0;
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
    flex-wrap: wrap;
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
