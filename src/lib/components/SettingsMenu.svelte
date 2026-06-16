<script lang="ts">
  import { settings } from "$lib/core/settings.svelte";

  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement | null>(null);

  let anthropicKey = $state("");
  let ollamaUrl = $state("");
  let ollamaModel = $state("");

  const panelStyle = $derived.by(() => {
    if (!open || !triggerEl) return "";
    const r = triggerEl.getBoundingClientRect();
    return `top:${r.bottom + 6}px;right:${window.innerWidth - r.right}px`;
  });

  // Sync local fields when the dropdown opens (or when settings first load).
  $effect(() => {
    if (open) {
      anthropicKey = settings.data.anthropicKey ?? "";
      ollamaUrl = settings.data.ollamaUrl ?? "";
      ollamaModel = settings.data.ollamaModel ?? "";
    }
  });

  function save(): void {
    settings.update({
      anthropicKey: anthropicKey.trim() || undefined,
      ollamaUrl: ollamaUrl.trim() || undefined,
      ollamaModel: ollamaModel.trim() || undefined,
    });
    open = false;
  }

  function toggleVim(): void {
    settings.update({ vimMode: !settings.data.vimMode });
  }
</script>

<div class="settings-menu">
  <button
    bind:this={triggerEl}
    class="trigger"
    class:active={open}
    onclick={() => (open = !open)}
    aria-label="Settings"
    title="Settings"
  >
    ⚙
  </button>

  {#if open}
    <button class="backdrop" onclick={() => (open = false)} aria-label="Close settings"></button>
    <div class="panel" style={panelStyle}>
      <p class="section-label">Editor</p>
      <label class="row">
        <span>Vim mode</span>
        <button
          class="toggle"
          class:on={settings.data.vimMode}
          onclick={toggleVim}
          role="switch"
          aria-checked={!!settings.data.vimMode}
        >
          {settings.data.vimMode ? "ON" : "OFF"}
        </button>
      </label>

      <p class="section-label">AI Provider</p>

      <label>
        Anthropic API key
        <input
          type="password"
          bind:value={anthropicKey}
          placeholder="sk-ant-…"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <label>
        Ollama URL <small>(optional, local models)</small>
        <input
          type="text"
          bind:value={ollamaUrl}
          placeholder="http://localhost:11434"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <label>
        Ollama model <small>(default: llama3.2)</small>
        <input
          type="text"
          bind:value={ollamaModel}
          placeholder="llama3.2"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <div class="actions">
        <button class="cancel" onclick={() => (open = false)}>Cancel</button>
        <button class="save" onclick={save}>Save</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .settings-menu {
    position: relative;
  }

  .trigger {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-dim);
    font-size: 0.95rem;
    padding: 0.35rem 0.55rem;
    cursor: pointer;
    line-height: 1;
  }

  .trigger:hover,
  .trigger.active {
    border-color: var(--accent);
    color: var(--text);
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    border: none;
    cursor: default;
    z-index: 40;
  }

  .panel {
    position: fixed;
    z-index: 200;
    width: 300px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.4);
    padding: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .section-label {
    margin: 0;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    font-weight: 600;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.82rem;
    color: var(--text);
    flex-direction: row;
    gap: 0;
  }

  .toggle {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-dim);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    font-family: inherit;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .toggle.on {
    border-color: var(--accent);
    color: var(--accent);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.78rem;
    color: var(--text-dim);
  }

  label small {
    font-size: 0.7rem;
  }

  input {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text);
    padding: 0.35rem 0.5rem;
    font-size: 0.82rem;
    outline: none;
    font-family: inherit;
  }

  input:focus {
    border-color: var(--accent);
  }

  .actions {
    display: flex;
    gap: 0.4rem;
    justify-content: flex-end;
    margin-top: 0.1rem;
  }

  .cancel {
    background: none;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text-dim);
    font-size: 0.8rem;
    padding: 0.3rem 0.7rem;
    cursor: pointer;
  }

  .save {
    background: var(--accent);
    border: none;
    border-radius: 7px;
    color: #0e1018;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.3rem 0.7rem;
    cursor: pointer;
  }

  .save:hover {
    filter: brightness(1.1);
  }
</style>
