<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { on } from "$lib/core/bus.svelte";
  import { library } from "$lib/core/library.svelte";
  import { toast } from "$lib/core/toast.svelte";
  import Editor from "$lib/components/Editor.svelte";
  import Markdown from "$lib/components/Markdown.svelte";
  import type { Paper } from "$lib/sources/types";
  import type { ModuleInstance } from "$lib/core/types";

  let {}: { instance: ModuleInstance } = $props();

  let paper = $state<Paper | null>(null);
  let preview = $state(false);
  let text = $state("");

  void library.ensureLoaded();

  // The note lives on the library entry, so a paper that arrives under another source's id
  // finds the same note. Until the paper is saved there is no record to write to.
  const recordId = $derived(paper ? library.idFor(paper) : undefined);
  const noteWaiting = $derived(paper !== null && recordId === undefined && library.hasOrphanNote(paper));

  $effect(() =>
    on("paper:selected", ({ paper: selected }) => {
      flush(); // the previous paper's last edit must not be lost or land on the new one
      paper = selected;
      preview = false;
    }),
  );

  // Load the note when the record changes. Reading the note itself is untracked: otherwise
  // every save would reload the text and fight the cursor.
  $effect(() => {
    const selected = paper;
    const id = recordId;
    untrack(() => {
      // A note written under this paper's own id before the library was the one record
      // is brought onto the record it matches.
      if (selected && id && library.hasOrphanNote(selected)) library.ensure(selected);
      text = id ? library.noteOf(id) : "";
    });
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: { id: string; text: string } | null = null;

  function handleChange(t: string): void {
    text = t;
    if (!recordId) return;
    pending = { id: recordId, text: t };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }

  function flush(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (!pending) return;
    const { id, text: latest } = pending;
    pending = null;
    library.setNote(id, latest);
  }

  onDestroy(flush);

  function save(): void {
    if (!paper) return;
    try {
      library.ensure(paper);
      toast(`Saved “${paper.title}” to your library.`, "success");
    } catch (err) {
      toast(`Could not save the paper: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }
</script>

<div class="annotations">
  {#if !paper}
    <p class="empty">
      Select a paper in <strong>Paper Search</strong> to annotate it here.
    </p>
  {:else if !library.loaded}
    <p class="empty">Loading…</p>
  {:else if recordId === undefined}
    <div class="header">
      <span class="paper-title" title={paper.title}>{paper.title}</span>
    </div>
    <div class="unsaved">
      <p>Save this paper to your library to add notes to it.</p>
      {#if noteWaiting}
        <p class="hint">You wrote a note on this paper in an earlier version. Saving it brings the note back.</p>
      {/if}
      <button type="button" class="save" onclick={save}>＋ Save to library</button>
    </div>
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

  .unsaved {
    margin: auto;
    text-align: center;
    max-width: 85%;
    color: var(--text-dim);
    font-size: 0.8rem;
    line-height: 1.5;
  }

  .unsaved p {
    margin: 0 0 0.6rem;
  }

  .hint {
    color: var(--accent);
  }

  .save {
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: #0e1018;
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.3rem 0.7rem;
    cursor: pointer;
  }
</style>
