<script lang="ts">
  import Markdown from "$lib/components/Markdown.svelte";
  import { latest, on } from "$lib/core/bus.svelte";
  import { library } from "$lib/core/library.svelte";
  import { fetchBytes, isAbortError } from "$lib/core/net";
  import { toast } from "$lib/core/toast.svelte";
  import type { ModuleInstance } from "$lib/core/types";
  import type { Paper } from "$lib/sources/types";
  import PdfView from "./PdfView.svelte";

  // Module contract: every module receives its instance, unused here.
  let {}: { instance: ModuleInstance } = $props();

  type Content = "none" | "loading" | "ready" | "error";

  let paper = $state.raw<Paper | null>(null);
  let view = $state<"overview" | "pdf" | "doc">("overview");
  let pdfData = $state.raw<Uint8Array | null>(null);
  let docText = $state("");
  let status = $state<Content>("none");
  let problem = $state("");

  let controller: AbortController | null = null;
  // Selections can arrive faster than files load; only the newest one may write state.
  let seq = 0;

  void library.ensureLoaded();

  // The library's copy of this paper, if saved — it may carry a local file.
  const saved = $derived(paper ? library.find(paper) : undefined);
  const kind = $derived<"pdf" | "markdown" | null>(
    (saved?.localFile ?? paper?.localFile)?.kind ?? (paper?.pdfUrl ? "pdf" : null),
  );

  function open(selected: Paper): void {
    controller?.abort();
    paper = selected;
    pdfData = null;
    docText = "";
    problem = "";
    view = "overview";
    const mine = ++seq;

    const local = library.find(selected)?.localFile ?? selected.localFile;
    if (local) {
      status = "loading";
      void loadLocal(local, mine);
    } else if (selected.pdfUrl) {
      status = "loading";
      void loadRemote(selected.pdfUrl, mine);
    } else {
      status = "none";
    }
  }

  // Catch up with whatever was selected before this Reader existed, then follow along.
  const earlier = latest("paper:selected");
  if (earlier) open(earlier.paper);
  $effect(() => on("paper:selected", ({ paper: selected }) => open(selected)));

  async function loadLocal(ref: NonNullable<Paper["localFile"]>, mine: number): Promise<void> {
    try {
      if (ref.kind === "markdown") {
        const text = await library.fileText(ref);
        if (mine !== seq) return;
        if (text === null) throw new Error("The stored file is missing. Remove the entry and add the file again.");
        docText = text;
        status = "ready";
        view = "doc";
      } else {
        const bytes = await library.fileBytes(ref);
        if (mine !== seq) return;
        if (bytes === null) throw new Error("The stored file is missing. Remove the entry and add the file again.");
        pdfData = bytes;
        status = "ready";
        view = "pdf";
      }
    } catch (err) {
      if (mine !== seq) return;
      status = "error";
      problem = err instanceof Error ? err.message : String(err);
    }
  }

  async function loadRemote(url: string, mine: number): Promise<void> {
    controller = new AbortController();
    try {
      const bytes = await fetchBytes(url, controller.signal);
      if (mine !== seq) return;
      pdfData = bytes;
      status = "ready";
    } catch (err) {
      if (isAbortError(err) || mine !== seq) return;
      status = "error";
      problem = err instanceof Error ? err.message : String(err);
    }
  }

  function authorLine(p: Paper): string {
    return p.authors.join(", ");
  }

  function save(): void {
    if (!paper) return;
    const { added } = library.add(paper);
    toast(added.length > 0 ? `Saved “${paper.title}” to your library.` : "Already in your library.", "success");
  }
</script>

<div class="reader">
  {#if !paper}
    <p class="empty">
      Select a paper in <strong>Paper Search</strong> or the <strong>Library</strong> and it opens here. You can also
      drop a PDF or markdown file onto the window.
    </p>
  {:else}
    <div class="tabs">
      <button class:on={view === "overview"} onclick={() => (view = "overview")}>Overview</button>
      {#if kind === "markdown"}
        <button class:on={view === "doc"} onclick={() => (view = "doc")} disabled={status !== "ready"}>
          {status === "loading" ? "Document ⏳" : "Document"}
        </button>
      {:else}
        <button class:on={view === "pdf"} onclick={() => (view = "pdf")} disabled={status === "none" || status === "error"}>
          {#if status === "loading"}PDF ⏳{:else if status === "none"}No PDF{:else}PDF{/if}
        </button>
      {/if}
      <span class="grow"></span>
      {#if saved}
        <span class="in-library" title="This paper is in your library">✓ In library</span>
      {:else}
        <button class="save" onclick={save}>＋ Save to library</button>
      {/if}
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
        {#if status === "loading"}
          <p class="pdf-note">{kind === "markdown" || paper.localFile || saved?.localFile ? "Opening the stored file…" : "Downloading open-access PDF…"}</p>
        {:else if status === "ready"}
          <p class="pdf-note ok">{kind === "markdown" ? "Document ready — switch to the Document tab." : "PDF ready — switch to the PDF tab."}</p>
        {:else if status === "error"}
          <p class="pdf-note err">Could not open the file: {problem}</p>
        {:else}
          <p class="pdf-note">
            No open-access PDF for this paper.{#if !saved?.localFile} Save it to your library and attach your own copy
              with “＋PDF”.{/if}
          </p>
        {/if}
      </article>
    {:else if view === "doc"}
      <div class="doc">
        <Markdown source={docText} />
      </div>
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
    min-height: 0;
  }

  .empty {
    margin: auto;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.8rem;
    max-width: 85%;
    line-height: 1.5;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.5rem;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
  }

  .grow {
    flex: 1;
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

  .tabs button.save {
    border: 1px solid var(--border);
    color: var(--text);
  }

  .tabs button.save:hover {
    border-color: var(--accent);
  }

  .in-library {
    font-size: 0.72rem;
    color: #9ece6a;
    padding-right: 0.3rem;
  }

  article,
  .doc {
    overflow: auto;
    padding: 0.7rem 0.9rem;
    min-height: 0;
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
