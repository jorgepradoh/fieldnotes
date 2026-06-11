<script lang="ts">
  import type { ModuleDefinition, ModuleInstance } from "$lib/core/types";

  let {
    def,
    instance,
    onmovestart,
    onresizestart,
    onclose,
  }: {
    def: ModuleDefinition;
    instance: ModuleInstance;
    onmovestart: (e: PointerEvent) => void;
    onresizestart: (e: PointerEvent) => void;
    onclose: () => void;
  } = $props();

  const Body = $derived(def.component);
</script>

<section class="frame">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onpointerdown={onmovestart}>
    <span class="icon">{def.icon}</span>
    <h2>{def.name}</h2>
    <button
      class="close"
      onpointerdown={(e) => e.stopPropagation()}
      onclick={onclose}
      title="Remove module"
      aria-label="Remove {def.name}"
    >
      ✕
    </button>
  </header>
  <div class="body">
    <Body {instance} />
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize" onpointerdown={onresizestart} title="Resize"></div>
</section>

<style>
  .frame {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.65rem;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    cursor: grab;
    touch-action: none;
    flex-shrink: 0;
  }

  header:active {
    cursor: grabbing;
  }

  .icon {
    font-size: 0.9rem;
  }

  h2 {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-dim);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .close {
    border: none;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0.1rem 0.3rem;
    border-radius: 4px;
  }

  .close:hover {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
    touch-action: none;
    background:
      linear-gradient(135deg, transparent 50%, var(--border) 50%, var(--border) 60%, transparent 60%, transparent 70%, var(--border) 70%, var(--border) 80%, transparent 80%);
    border-bottom-right-radius: var(--radius);
  }
</style>
