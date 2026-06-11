<script lang="ts">
  import { busLog } from "$lib/core/bus.svelte";
  import { workspace } from "$lib/core/workspace.svelte";
  import type { ModuleInstance } from "$lib/core/types";

  // Module contract: every module receives its instance, unused here.
  let {}: { instance: ModuleInstance } = $props();

  const entries = $derived([...busLog].reverse());
  const layoutJson = $derived(
    JSON.stringify($state.snapshot(workspace.instances), null, 2),
  );
</script>

<div class="debug">
  <h3>Event bus</h3>
  {#if entries.length === 0}
    <p class="empty">No events yet — search for something or let the pomodoro tick over.</p>
  {:else}
    <ul>
      {#each entries as entry (entry.seq)}
        <li>
          <span class="time">{entry.time}</span>
          <span class="name">{entry.name}</span>
          <code>{JSON.stringify(entry.payload)}</code>
        </li>
      {/each}
    </ul>
  {/if}

  <details>
    <summary>Workspace layout JSON</summary>
    <pre>{layoutJson}</pre>
  </details>
</div>

<style>
  .debug {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 0.6rem;
    gap: 0.4rem;
    font-size: 0.75rem;
  }

  h3 {
    margin: 0;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  .empty {
    color: var(--text-dim);
    margin: 0.4rem 0;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  li {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    white-space: nowrap;
  }

  .time {
    color: var(--text-dim);
  }

  .name {
    color: var(--accent);
    font-weight: 600;
  }

  code {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  details {
    flex-shrink: 0;
    color: var(--text-dim);
  }

  pre {
    max-height: 140px;
    overflow: auto;
    background: var(--surface-2);
    border-radius: 6px;
    padding: 0.5rem;
    margin: 0.3rem 0 0;
  }
</style>
