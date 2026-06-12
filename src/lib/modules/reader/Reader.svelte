<script lang="ts">
  import { on } from "$lib/core/bus.svelte";
  import { fetchBytes } from "$lib/core/net";
  import type { ModuleInstance } from "$lib/core/types";
  import type { Paper } from "$lib/sources/types";
  import PdfView from "./PdfView.svelte";

  // Module contract: every module receives its instance, unused here.
  let {}: { instance: ModuleInstance } = $props();

  let paper = $state<Paper | null>(null);
  let view = $state<"overview" | "pdf">("overview");
  let pdfData = $state<Uint8Array | null>(null);
  let pdfStatus = $state<"none" | "loading" | "ready" | "error">("none");
  let pdfError = $state("");

  let controller: AbortController | null = null;

  $effect(() =>
    on("paper:selected", ({ paper: selected }) => {
      paper = selected;
      view = "overview";
      pdfData = null;
      pdfError = "";
      if (selected.pdfUrl) {
        void loadPdf(selected.pdfUrl);
      } else {
        pdfStatus = "none";
      }
    }),
  );

  async function loadPdf(url: string): Promise<void> {
    controller?.abort();
    controller = new AbortController();
    pdfStatus = "loading";
    try {
      const bytes = await fetchBytes(url, controller.signal);
      pdfData = bytes;
      pdfStatus = "ready";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      pdfStatus = "error";
      pdfError = err instanceof Error ? err.message : String(err);
    }
  }

  function authorLine(p: Paper): string {
    return p.authors.join(", ");
  }
</script>

<div class="reader">
  {#if !paper}
    <p class="empty">
      Select a paper in <strong>Paper Search</strong> and it opens here.
    </p>
  {:else}
    <div class="tabs">
      <button class:on={view === "overview"} onclick={() => (view = "overview")}>
        Overview
      </button>
      <button
        class:on={view === "pdf"}
        onclick={() => (view = "pdf")}
        disabled={pdfStatus === "none" || pdfStatus === "error"}
      >
        {#if pdfStatus === "loading"}PDF ⏳{:else if pdfStatus === "none"}No PDF{:else}PDF{/if}
      </button>
    </div>

    {#if view === "overview"}
      <article>
        <h3>{paper.title}</h3>
        <p class="meta">
          {authorLine(paper)}
          {#if paper.year}· {paper.year}{/if}
          {#if paper.venue}· {paper.venue}{/if}
          {#if paper.citationCount != null}· {paper.citationCount.toLocaleString()} citations{/if}
        </p>
        {#if paper.tldr}
          <p class="tldr"><strong>TL;DR</strong> {paper.tldr}</p>
        {/if}
        {#if paper.abstract}
          <p class="abstract">{paper.abstract}</p>
        {:else}
          <p class="abstract dim">No abstract available for this paper.</p>
        {/if}
        {#if pdfStatus === "loading"}
          <p class="pdf-note">Downloading open-access PDF…</p>
        {:else if pdfStatus === "ready"}
          <p class="pdf-note ok">PDF ready — switch to the PDF tab.</p>
        {:else if pdfStatus === "error"}
          <p class="pdf-note err">PDF download failed: {pdfError}</p>
        {:else}
          <p class="pdf-note">No open-access PDF for this paper.</p>
        {/if}
      </article>
    {:else if pdfData}
      {#key paper.id}
        <PdfView data={pdfData} />
      {/key}
    {/if}
  {/if}
</div>

<style>
  .reader {
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

  .tabs {
    display: flex;
    gap: 0.3rem;
    padding: 0.4rem 0.5rem;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
  }

  .tabs button {
    border: none;
    background: none;
    color: var(--text-dim);
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    cursor: pointer;
  }

  .tabs button.on {
    background: var(--surface-2);
    color: var(--text);
  }

  .tabs button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  article {
    overflow: auto;
    padding: 0.7rem 0.9rem;
  }

  h3 {
    margin: 0 0 0.3rem;
    font-size: 0.95rem;
    line-height: 1.35;
  }

  .meta {
    margin: 0 0 0.6rem;
    font-size: 0.74rem;
    color: var(--text-dim);
  }

  .tldr {
    margin: 0 0 0.6rem;
    font-size: 0.8rem;
    line-height: 1.45;
    background: color-mix(in srgb, var(--accent) 9%, transparent);
    border-left: 3px solid var(--accent);
    border-radius: 0 6px 6px 0;
    padding: 0.45rem 0.6rem;
  }

  .abstract {
    margin: 0 0 0.6rem;
    font-size: 0.82rem;
    line-height: 1.55;
  }

  .abstract.dim {
    color: var(--text-dim);
  }

  .pdf-note {
    margin: 0;
    font-size: 0.74rem;
    color: var(--text-dim);
  }

  .pdf-note.ok {
    color: #9ece6a;
  }

  .pdf-note.err {
    color: var(--danger);
  }
</style>
