<script lang="ts">
  import { onMount } from "svelte";

  let { data }: { data: Uint8Array } = $props();

  let container: HTMLDivElement;
  let status = $state<"rendering" | "done" | "error">("rendering");
  let error = $state("");
  let pageCount = $state(0);
  let pagesDone = $state(0);

  onMount(() => {
    let cancelled = false;

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        // pdf.js transfers the buffer to its worker — hand it a copy.
        const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
        if (cancelled) return;
        pageCount = doc.numPages;

        const targetWidth = container.clientWidth - 2;
        const dpr = window.devicePixelRatio || 1;

        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = targetWidth / base.width;
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / dpr}px`;
          canvas.style.height = `${viewport.height / dpr}px`;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas 2D context unavailable");

          container.appendChild(canvas);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          pagesDone = i;
        }
        status = "done";
      } catch (err) {
        if (cancelled) return;
        status = "error";
        error = err instanceof Error ? err.message : String(err);
      }
    })();

    return () => {
      cancelled = true;
    };
  });
</script>

<div class="pdf">
  {#if status === "rendering"}
    <p class="status">
      Rendering{pageCount > 0 ? ` page ${pagesDone + 1} of ${pageCount}` : "…"}
    </p>
  {:else if status === "error"}
    <p class="status error">Could not render PDF: {error}</p>
  {/if}
  <div class="pages" bind:this={container}></div>
</div>

<style>
  .pdf {
    height: 100%;
    overflow: auto;
    background: #0b0d12;
  }

  .status {
    margin: 0;
    padding: 0.4rem 0.6rem;
    font-size: 0.72rem;
    color: var(--text-dim);
  }

  .status.error {
    color: var(--danger);
  }

  .pages {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    padding: 8px;
  }

  .pages :global(canvas) {
    box-shadow: 0 2px 12px rgb(0 0 0 / 0.5);
    border-radius: 2px;
  }
</style>
