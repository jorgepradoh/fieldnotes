<script lang="ts">
  import Markdown from "$lib/components/Markdown.svelte";
  import { workspace } from "$lib/core/workspace.svelte";
  import Editor from "$lib/components/Editor.svelte";
  import type { ModuleInstance } from "$lib/core/types";

  let { instance }: { instance: ModuleInstance } = $props();

  // svelte-ignore state_referenced_locally
  let text = $state(String(instance.settings.text ?? ""));
  let preview = $state(false);

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
    <!-- Notes often hold pasted web text, so they get the same sanitising renderer as everything else. -->
    <div class="preview"><Markdown source={text} /></div>
  {:else}
    <Editor value={text} onchange={(t) => (text = t)} placeholder="Write markdown…" />
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

  .preview {
    flex: 1;
    overflow: auto;
    padding: 0.2rem 0.8rem 0.8rem;
    font-size: 0.85rem;
    line-height: 1.55;
  }
</style>
