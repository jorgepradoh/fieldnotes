<script lang="ts">
  import { marked } from "marked";
  import { workspace } from "$lib/core/workspace.svelte";
  import type { ModuleInstance } from "$lib/core/types";

  let { instance }: { instance: ModuleInstance } = $props();

  // Settings hydrate initial state once; edits flow back via updateSettings.
  // svelte-ignore state_referenced_locally
  let text = $state(String(instance.settings.text ?? ""));
  let preview = $state(false);

  // Rendering the user's own local notes — not remote content.
  const html = $derived(marked.parse(text, { async: false }));

  $effect(() => {
    const current = text;
    const timer = setTimeout(
      () => workspace.updateSettings(instance.instanceId, { text: current }),
      400,
    );
    return () => clearTimeout(timer);
  });
</script>

<div class="notes">
  <div class="toolbar">
    <button class:on={!preview} onclick={() => (preview = false)}>Edit</button>
    <button class:on={preview} onclick={() => (preview = true)}>Preview</button>
  </div>
  {#if preview}
    <div class="preview">{@html html}</div>
  {:else}
    <textarea bind:value={text} placeholder="Write markdown…" spellcheck="false"></textarea>
  {/if}
</div>

<style>
  .notes {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .toolbar {
    display: flex;
    gap: 0.3rem;
    padding: 0.4rem 0.5rem 0;
    flex-shrink: 0;
  }

  .toolbar button {
    border: none;
    background: none;
    color: var(--text-dim);
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .toolbar button.on {
    background: var(--surface-2);
    color: var(--text);
  }

  textarea {
    flex: 1;
    resize: none;
    border: none;
    outline: none;
    background: none;
    color: var(--text);
    padding: 0.6rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.82rem;
    line-height: 1.5;
  }

  .preview {
    flex: 1;
    overflow: auto;
    padding: 0.2rem 0.8rem 0.8rem;
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
</style>
