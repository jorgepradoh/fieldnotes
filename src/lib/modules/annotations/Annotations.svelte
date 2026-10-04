<script lang="ts">
  import { on } from "$lib/core/bus.svelte";
  import { annotations } from "$lib/core/annotations.svelte";
  import Editor from "$lib/components/Editor.svelte";
  import Markdown from "$lib/components/Markdown.svelte";
  import type { Paper } from "$lib/sources/types";
  import type { ModuleInstance } from "$lib/core/types";

  let {}: { instance: ModuleInstance } = $props();

  let paper = $state<Paper | null>(null);
  let preview = $state(false);
  let text = $state("");

  $effect(() =>
    on("paper:selected", ({ paper: selected }) => {
      paper = selected;
      preview = false;
      text = annotations.get(selected.id);
    }),
  );

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function handleChange(t: string): void {
    text = t;
    if (!paper) return;
    if (saveTimer) clearTimeout(saveTimer);
    const pid = paper.id;
    saveTimer = setTimeout(() => {
      annotations.set(pid, t);
    }, 400);
  }
</script>

<div class="annotations">
  {#if !paper}
    <p class="empty">
      Select a paper in <strong>Paper Search</strong> to annotate it here.
    </p>
  {:else}
    <div class="header">
      <span class="paper-title" title={paper.title}>{paper.title}</span>
      <div class="tabs">
        <button class:on={!preview} onclick={() => (preview = false)}>Edit</button>
        <button class:on={preview} onclick={() => (preview = true)}>Preview</button>
      </div>
    </div>

    {#if preview}
      <div class="preview">
        {#if text}
          <!-- Annotations often hold pasted web text, so they get the same sanitising renderer as Notes. -->
          <Markdown source={text} />
        {:else}
          <p class="dim">Nothing written yet.</p>
        {/if}
      </div>
    {:else}
      <Editor value={text} onchange={handleChange} placeholder="Write notes about this paper…" />
    {/if}
  {/if}
</div>

<style>
  .annotations {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .empty {
    margin: auto;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.8rem;
    max-width: 85%;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .paper-title {
    flex: 1;
    min-width: 0;
    font-size: 0.72rem;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .tabs button {
    border: none;
    background: none;
    color: var(--text-dim);
    font-size: 0.72rem;
    padding: 0.15rem 0.45rem;
    border-radius: 5px;
    cursor: pointer;
  }

  .tabs button.on {
    background: var(--surface-2);
    color: var(--text);
  }

  .preview {
    flex: 1;
    overflow: auto;
    padding: 0.4rem 0.8rem 0.8rem;
    font-size: 0.85rem;
    line-height: 1.55;
  }

  .preview :global(h1),
  .preview :global(h2),
  .preview :global(h3) {
    margin: 0.6em 0 0.3em;
  }

  .preview :global(a) {
    color: var(--accent);
  }

  .preview :global(code) {
    background: var(--surface-2);
    padding: 0.1em 0.3em;
    border-radius: 4px;
    font-size: 0.9em;
  }

  .dim {
    color: var(--text-dim);
    font-style: italic;
    font-size: 0.82rem;
  }
</style>
