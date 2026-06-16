<script lang="ts">
  import { on, emit } from "$lib/core/bus.svelte";
  import { queue } from "$lib/core/queue.svelte";
  import type { QueueStatus } from "$lib/core/queue.svelte";
  import type { Paper } from "$lib/sources/types";
  import type { ModuleInstance } from "$lib/core/types";

  let {}: { instance: ModuleInstance } = $props();

  let current = $state<Paper | null>(null);

  $effect(() =>
    on("paper:selected", ({ paper }) => {
      current = paper;
    }),
  );

  const COLUMNS: { status: QueueStatus; label: string }[] = [
    { status: "to-read", label: "To Read" },
    { status: "reading", label: "Reading" },
    { status: "done", label: "Done" },
  ];

  const ADVANCE_LABEL: Record<QueueStatus, string> = {
    "to-read": "Start →",
    reading: "Done →",
    done: "Remove",
  };

  function authorLine(paper: Paper): string {
    const names = paper.authors.slice(0, 2).join(", ");
    return paper.authors.length > 2 ? `${names} et al.` : names;
  }
</script>

<div class="queue">
  {#if current && !queue.has(current.id)}
    <div class="banner">
      <span class="banner-title" title={current.title}>{current.title}</span>
      <button class="add-btn" onclick={() => current && queue.add(current)}>+ Queue</button>
    </div>
  {/if}

  <div class="columns">
    {#each COLUMNS as col}
      {@const entries = queue.column(col.status)}
      <div class="col">
        <div class="col-header">
          <span class="col-label">{col.label}</span>
          <span class="col-count">{entries.length}</span>
        </div>
        <ul>
          {#each entries as { paper } (paper.id)}
            <li class:active={current?.id === paper.id}>
              <button class="paper" onclick={() => emit("paper:selected", { paper })}>
                <span class="title">{paper.title}</span>
                <span class="meta">
                  {authorLine(paper)}{#if paper.year} · {paper.year}{/if}
                </span>
              </button>
              <div class="actions">
                <button
                  class="advance"
                  onclick={() => queue.advance(paper.id)}
                  title={ADVANCE_LABEL[col.status]}
                >
                  {ADVANCE_LABEL[col.status]}
                </button>
                <button
                  class="remove"
                  onclick={() => queue.remove(paper.id)}
                  aria-label="Remove from queue"
                >×</button>
              </div>
            </li>
          {/each}
          {#if entries.length === 0}
            <li class="empty-col">—</li>
          {/if}
        </ul>
      </div>
    {/each}
  </div>
</div>

<style>
  .queue {
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

  .add-btn {
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

  .columns {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .col {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    min-height: 0;
  }

  .col:last-child {
    border-right: none;
  }

  .col-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .col-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 600;
  }

  .col-count {
    font-size: 0.68rem;
    color: var(--text-dim);
    background: var(--surface-2);
    border-radius: 10px;
    padding: 0.05rem 0.4rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0.35rem;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    flex: 1;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  li.active .paper {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  }

  .empty-col {
    color: var(--text-dim);
    font-size: 0.75rem;
    text-align: center;
    padding: 0.5rem 0;
  }

  .paper {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 7px;
    padding: 0.35rem 0.45rem;
    cursor: pointer;
  }

  .paper:hover {
    border-color: var(--accent);
  }

  .title {
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .meta {
    font-size: 0.67rem;
    color: var(--text-dim);
  }

  .actions {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }

  .advance {
    flex: 1;
    background: none;
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-dim);
    font-size: 0.67rem;
    padding: 0.15rem 0.3rem;
    cursor: pointer;
    text-align: center;
  }

  .advance:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .remove {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 0.95rem;
    line-height: 1;
    padding: 0.1rem 0.3rem;
    cursor: pointer;
    border-radius: 5px;
  }

  .remove:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
</style>
