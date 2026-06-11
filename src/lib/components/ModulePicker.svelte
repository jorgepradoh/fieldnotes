<script lang="ts">
  import { allModules } from "$lib/core/registry";
  import { workspace } from "$lib/core/workspace.svelte";

  let open = $state(false);

  function isPlaced(moduleId: string, multiInstance: boolean | undefined): boolean {
    return !multiInstance && workspace.instances.some((it) => it.moduleId === moduleId);
  }

  function pick(moduleId: string): void {
    workspace.add(moduleId);
    open = false;
  }
</script>

<div class="picker">
  <button class="add" onclick={() => (open = !open)}>+ Add module</button>

  {#if open}
    <button class="backdrop" onclick={() => (open = false)} aria-label="Close menu"></button>
    <ul class="menu">
      {#each allModules() as def (def.id)}
        <li>
          <button
            class="item"
            onclick={() => pick(def.id)}
            disabled={isPlaced(def.id, def.multiInstance)}
          >
            <span class="icon">{def.icon}</span>
            <span class="text">
              <strong>{def.name}</strong>
              <small>{def.description}</small>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker {
    position: relative;
  }

  .add {
    background: var(--accent);
    color: #0e1018;
    border: none;
    border-radius: 8px;
    padding: 0.45rem 0.9rem;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .add:hover {
    filter: brightness(1.1);
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
    right: 0;
    top: calc(100% + 6px);
    z-index: 50;
    margin: 0;
    padding: 0.3rem;
    list-style: none;
    width: 280px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.4);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.5rem 0.6rem;
    background: none;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
  }

  .item:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .item:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .icon {
    font-size: 1.1rem;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .text strong {
    font-size: 0.85rem;
  }

  .text small {
    color: var(--text-dim);
    font-size: 0.75rem;
  }
</style>
