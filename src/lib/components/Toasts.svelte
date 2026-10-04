<script lang="ts">
  import { dismissToast, toasts } from "$lib/core/toast.svelte";
</script>

<div class="toasts" aria-live="polite">
  {#each toasts as t (t.id)}
    <button class="toast {t.kind}" onclick={() => dismissToast(t.id)} title="Dismiss">
      {t.text}
    </button>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    z-index: 200;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-width: min(420px, calc(100vw - 2rem));
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    padding: 0.55rem 0.8rem;
    font-size: 0.82rem;
    line-height: 1.4;
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.4);
    cursor: pointer;
    white-space: pre-line;
  }

  .toast.success {
    border-left-color: #9ece6a;
  }

  .toast.error {
    border-left-color: var(--danger);
  }
</style>
