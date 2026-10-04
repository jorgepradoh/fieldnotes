<script lang="ts">
  import { pickFiles, saveTextFile } from "$lib/core/files";
  import { importFiles } from "$lib/core/importer";
  import { PRESETS } from "$lib/core/presets";
  import { toast } from "$lib/core/toast.svelte";
  import { workspace } from "$lib/core/workspace.svelte";

  type Mode =
    | { kind: "list" }
    | { kind: "rename"; id: string }
    | { kind: "saveAs" }
    | { kind: "confirmDelete"; id: string };

  let open = $state(false);
  let mode = $state<Mode>({ kind: "list" });
  let draft = $state("");
  let showPresets = $state(false);
  let includeContent = $state(false);

  function close(): void {
    open = false;
    mode = { kind: "list" };
    showPresets = false;
  }

  function startRename(id: string, current: string): void {
    draft = current;
    mode = { kind: "rename", id };
  }

  function startSaveAs(): void {
    draft = `${workspace.name} copy`;
    mode = { kind: "saveAs" };
  }

  function commitDraft(): void {
    if (mode.kind === "rename") {
      workspace.rename(mode.id, draft);
    } else if (mode.kind === "saveAs") {
      workspace.saveCurrentAs(draft);
      toast(`Saved as “${workspace.name}”.`, "success");
      close();
      return;
    }
    mode = { kind: "list" };
  }

  function onDraftKey(e: KeyboardEvent): void {
    if (e.key === "Enter") commitDraft();
    if (e.key === "Escape") {
      e.stopPropagation();
      mode = { kind: "list" };
    }
  }

  function switchTo(id: string): void {
    workspace.switchTo(id);
    close();
  }

  function createFrom(presetId: string): void {
    const preset = PRESETS.find((p) => p.id === presetId);
    workspace.createLayout(preset?.name ?? "New layout", presetId);
    close();
  }

  function remove(id: string): void {
    workspace.removeLayout(id);
    mode = { kind: "list" };
  }

  async function exportLayout(): Promise<void> {
    const { fileName, json } = workspace.exportActive(includeContent);
    try {
      const result = await saveTextFile(fileName, json, "application/json");
      if (result === "saved") {
        toast(
          includeContent
            ? `Exported “${workspace.name}” with module contents. API keys are never included.`
            : `Exported the “${workspace.name}” layout. Notes and queries were left out.`,
          "success",
        );
      }
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
    close();
  }

  async function importLayout(): Promise<void> {
    close();
    const files = await pickFiles(".json,application/json");
    if (files.length > 0) await importFiles(files);
  }

  function onWindowKey(e: KeyboardEvent): void {
    if (open && e.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="layouts">
  <button class="trigger" onclick={() => (open ? close() : (open = true))} aria-haspopup="menu" aria-expanded={open}>
    <span class="name">{workspace.name}</span>
    <span class="caret">▾</span>
  </button>

  {#if open}
    <button class="backdrop" onclick={close} aria-label="Close menu"></button>
    <div class="menu" role="menu">
      <p class="heading">Layouts</p>
      <ul>
        {#each workspace.layouts as layout (layout.id)}
          <li class:active={layout.id === workspace.activeId}>
            {#if mode.kind === "rename" && mode.id === layout.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="inline"
                bind:value={draft}
                onkeydown={onDraftKey}
                onblur={commitDraft}
                maxlength="60"
                aria-label="Layout name"
                autofocus
              />
            {:else if mode.kind === "confirmDelete" && mode.id === layout.id}
              <span class="confirm">Delete “{layout.name}”?</span>
              <button class="danger" onclick={() => remove(layout.id)}>Delete</button>
              <button onclick={() => (mode = { kind: "list" })}>Keep</button>
            {:else}
              <button class="pick" role="menuitemradio" aria-checked={layout.id === workspace.activeId} onclick={() => switchTo(layout.id)}>
                <span class="dot">{layout.id === workspace.activeId ? "●" : "○"}</span>
                <span class="label">{layout.name}</span>
              </button>
              <span class="row-actions">
                <button title="Rename" aria-label="Rename {layout.name}" onclick={() => startRename(layout.id, layout.name)}>✎</button>
                <button
                  title="Duplicate"
                  aria-label="Duplicate {layout.name}"
                  onclick={() => {
                    workspace.duplicate(layout.id);
                  }}>⧉</button
                >
                <button
                  title={workspace.layouts.length > 1 ? "Delete" : "You need at least one layout"}
                  aria-label="Delete {layout.name}"
                  disabled={workspace.layouts.length <= 1}
                  onclick={() => (mode = { kind: "confirmDelete", id: layout.id })}>✕</button
                >
              </span>
            {/if}
          </li>
        {/each}
      </ul>

      <hr />

      <button class="action" onclick={() => (showPresets = !showPresets)} aria-expanded={showPresets}>
        <span>＋ New layout</span><span class="caret">{showPresets ? "▾" : "▸"}</span>
      </button>
      {#if showPresets}
        <ul class="presets">
          {#each PRESETS as preset (preset.id)}
            <li>
              <button class="preset" onclick={() => createFrom(preset.id)}>
                <strong>{preset.name}</strong>
                <small>{preset.description}</small>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if mode.kind === "saveAs"}
        <div class="saveas">
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={draft} onkeydown={onDraftKey} maxlength="60" aria-label="New layout name" autofocus />
          <button class="primary" onclick={commitDraft}>Save</button>
        </div>
      {:else}
        <button class="action" onclick={startSaveAs}>⧉ Save current as…</button>
      {/if}

      <hr />

      <button class="action" onclick={exportLayout}>⭳ Export “{workspace.name}”…</button>
      <label class="check">
        <input type="checkbox" bind:checked={includeContent} />
        Include module contents <small>(notes, queries, last AI brief)</small>
      </label>
      <button class="action" onclick={importLayout}>⭱ Import layout…</button>
      <p class="note">API keys are never exported. You can also drop a layout file onto the window.</p>
    </div>
  {/if}
</div>

<style>
  .layouts {
    position: relative;
  }

  .trigger {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 0.25rem 0.5rem;
    color: var(--text-dim);
    font-size: 0.9rem;
    cursor: pointer;
    max-width: 280px;
  }

  .trigger:hover,
  .trigger[aria-expanded="true"] {
    border-color: var(--border);
    color: var(--text);
    background: var(--surface-2);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caret {
    font-size: 0.7rem;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    border: none;
    cursor: default;
    z-index: 40;
  }

  .menu {
    position: absolute;
    left: 0;
    top: calc(100% + 6px);
    z-index: 50;
    width: 320px;
    padding: 0.4rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.4);
    max-height: calc(100vh - 80px);
    overflow: auto;
  }

  .heading {
    margin: 0.2rem 0.5rem 0.3rem;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    border-radius: 8px;
  }

  li.active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  li:hover:not(.active) {
    background: color-mix(in srgb, var(--accent) 7%, transparent);
  }

  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    padding: 0.4rem 0.5rem;
    text-align: left;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .dot {
    color: var(--accent);
    font-size: 0.7rem;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-actions {
    display: flex;
    opacity: 0;
    padding-right: 0.2rem;
  }

  li:hover .row-actions,
  li:focus-within .row-actions {
    opacity: 1;
  }

  .row-actions button {
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 0.25rem 0.35rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .row-actions button:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface);
  }

  .row-actions button:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .confirm {
    flex: 1;
    padding: 0.4rem 0.5rem;
    font-size: 0.82rem;
  }

  li > button:not(.pick) {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
    cursor: pointer;
    margin-right: 0.3rem;
  }

  li > button.danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 50%, transparent);
  }

  input.inline,
  .saveas input {
    flex: 1;
    min-width: 0;
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 0.3rem 0.5rem;
    font-size: 0.85rem;
    outline: none;
    margin: 0.1rem 0.2rem;
  }

  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.35rem 0;
  }

  .action {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    background: none;
    border: none;
    border-radius: 8px;
    padding: 0.45rem 0.5rem;
    text-align: left;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .action:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .presets {
    margin: 0 0 0.2rem 0.6rem;
    border-left: 2px solid var(--border);
    padding-left: 0.3rem;
  }

  .preset {
    display: flex;
    flex-direction: column;
    width: 100%;
    background: none;
    border: none;
    border-radius: 8px;
    padding: 0.35rem 0.5rem;
    text-align: left;
    cursor: pointer;
  }

  .preset:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .preset strong {
    font-size: 0.82rem;
  }

  .preset small {
    color: var(--text-dim);
    font-size: 0.72rem;
  }

  .saveas {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.3rem;
  }

  .primary {
    background: var(--accent);
    color: #0e1018;
    border: none;
    border-radius: 6px;
    padding: 0.3rem 0.7rem;
    font-weight: 600;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .check {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    padding: 0 0.5rem 0.3rem 1.55rem;
    font-size: 0.76rem;
    color: var(--text-dim);
  }

  .note {
    margin: 0.2rem 0.5rem 0.3rem;
    font-size: 0.7rem;
    color: var(--text-dim);
    line-height: 1.4;
  }
</style>
