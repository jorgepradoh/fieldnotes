<script lang="ts">
  import { importFiles } from "$lib/core/importer";

  /**
   * Window-wide file drop. Needs Tauri's own drag-drop handler turned off
   * (dragDropEnabled: false in tauri.conf.json) so the webview receives the
   * HTML5 events; the same code works unchanged in a plain browser.
   */
  let dragging = $state(false);
  let depth = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;

  const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  function hide(): void {
    dragging = false;
    depth = 0;
    clearTimeout(idle);
  }

  function onDragEnter(e: DragEvent): void {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    dragging = true;
  }

  function onDragOver(e: DragEvent): void {
    if (!hasFiles(e)) return;
    // Without this the webview would navigate to the dropped file.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    // Some webviews never send a final dragleave when the pointer leaves the window.
    clearTimeout(idle);
    idle = setTimeout(hide, 800);
  }

  function onDragLeave(e: DragEvent): void {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) hide();
  }

  function onDrop(e: DragEvent): void {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    hide();
    if (files.length > 0) void importFiles(files);
  }
</script>

<svelte:window ondragenter={onDragEnter} ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDrop} />

{#if dragging}
  <div class="overlay" aria-hidden="true">
    <div class="card">
      <strong>Drop to import</strong>
      <span>PDFs, markdown notes, BibTeX (.bib) or a layout file</span>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    border: 3px dashed var(--accent);
    pointer-events: none;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    align-items: center;
    padding: 1.2rem 2rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.4);
  }

  .card strong {
    font-size: 1.1rem;
  }

  .card span {
    color: var(--text-dim);
    font-size: 0.85rem;
  }
</style>
