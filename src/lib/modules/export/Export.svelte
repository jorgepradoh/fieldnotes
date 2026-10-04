<script lang="ts">
  import { library } from "$lib/core/library.svelte";
  import { annotations } from "$lib/core/annotations.svelte";
  import { toBibTeX, toMarkdown, toJSON } from "$lib/core/exporters";
  import { saveTextFile } from "$lib/core/files";
  import type { ModuleInstance } from "$lib/core/types";

  let {}: { instance: ModuleInstance } = $props();

  type Format = "bibtex" | "markdown" | "json";

  let format = $state<Format>("bibtex");
  let includeAnnotations = $state(true);
  let status = $state<"idle" | "saving" | "done" | "error">("idle");
  let message = $state("");

  const annotatedCount = $derived(
    library.entries.filter((e) => !!annotations.get(e.paper.id)).length,
  );

  const EXT: Record<Format, string> = { bibtex: "bib", markdown: "md", json: "json" };
  const LABEL: Record<Format, string> = {
    bibtex: "BibTeX (.bib)",
    markdown: "Markdown (.md)",
    json: "JSON (.json)",
  };

  async function exportLibrary(): Promise<void> {
    if (library.entries.length === 0) return;
    status = "saving";
    message = "";

    try {
      const noteMap = includeAnnotations
        ? (annotations.notes as Record<string, string>)
        : {};
      const entries = library.entries;

      let content: string;
      if (format === "bibtex") content = toBibTeX(entries, noteMap);
      else if (format === "markdown") content = toMarkdown(entries, noteMap);
      else content = toJSON(entries, noteMap);

      const result = await saveTextFile(`research-library.${EXT[format]}`, content);
      if (result === "cancelled") { status = "idle"; return; }
      status = "done";
      message = LABEL[format];
    } catch (err) {
      status = "error";
      message = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<div class="export">
  <div class="summary">
    <span class="count">{library.entries.length} papers</span>
    {#if annotatedCount > 0}
      <span class="dim">· {annotatedCount} annotated</span>
    {/if}
  </div>

  <div class="section">
    <p class="label">Format</p>
    <div class="radios">
      {#each (["bibtex", "markdown", "json"] as Format[]) as f}
        <label class="radio">
          <input type="radio" bind:group={format} value={f} />
          {LABEL[f]}
        </label>
      {/each}
    </div>
  </div>

  <label class="checkbox">
    <input type="checkbox" bind:checked={includeAnnotations} />
    Include annotations
  </label>

  <button
    class="export-btn"
    onclick={() => void exportLibrary()}
    disabled={library.entries.length === 0 || status === "saving"}
  >
    {status === "saving" ? "Saving…" : "Export Library"}
  </button>

  {#if status === "done"}
    <p class="feedback ok">Saved as {message}</p>
  {:else if status === "error"}
    <p class="feedback err">{message}</p>
  {:else if library.entries.length === 0}
    <p class="empty">Save papers to your library first.</p>
  {/if}
</div>

<style>
  .export {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0.8rem 0.75rem;
    height: 100%;
    overflow: auto;
  }

  .summary {
    font-size: 0.82rem;
  }

  .dim {
    color: var(--text-dim);
  }

  .count {
    font-weight: 600;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .label {
    margin: 0;
    font-size: 0.72rem;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .radios {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .radio {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.82rem;
    cursor: pointer;
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.82rem;
    cursor: pointer;
  }

  input[type="radio"],
  input[type="checkbox"] {
    accent-color: var(--accent);
    cursor: pointer;
  }

  .export-btn {
    background: var(--accent);
    color: #0e1018;
    border: none;
    border-radius: 8px;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    align-self: flex-start;
  }

  .export-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .feedback {
    margin: 0;
    font-size: 0.78rem;
    border-radius: 8px;
    padding: 0.4rem 0.6rem;
  }

  .feedback.ok {
    color: #9ece6a;
    background: color-mix(in srgb, #9ece6a 10%, transparent);
  }

  .feedback.err {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }

  .empty {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-dim);
  }
</style>
