<script lang="ts">
  import { onMount } from "svelte";
  import Dashboard from "$lib/components/Dashboard.svelte";
  import ModulePicker from "$lib/components/ModulePicker.svelte";
  import SettingsMenu from "$lib/components/SettingsMenu.svelte";
  import { annotations } from "$lib/core/annotations.svelte";
  import { library } from "$lib/core/library.svelte";
  import { queue } from "$lib/core/queue.svelte";
  import { settings } from "$lib/core/settings.svelte";
  import { workspace } from "$lib/core/workspace.svelte";
  import { zen } from "$lib/core/zen.svelte";
  import { emit } from "$lib/core/bus.svelte";
  import { registerBuiltinModules } from "$lib/modules";

  registerBuiltinModules();

  function loadOrReport(source: string, p: Promise<void>): void {
    p.catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      emit("app:error", { source, message });
    });
  }

  onMount(() => {
    loadOrReport("workspace", workspace.load());
    loadOrReport("library", library.load());
    loadOrReport("annotations", annotations.load());
    loadOrReport("queue", queue.load());
    loadOrReport("settings", settings.load());
  });

  function handleKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "F") {
      e.preventDefault();
      zen.toggle();
    }
  }
</script>

<svelte:window onkeydown={handleKey} />

<div class="app" class:zen={zen.active}>
  <header class="topbar" class:zen-hidden={zen.active}>
    <span class="logo">fieldnotes</span>
    <span class="divider">/</span>
    <span class="workspace">{workspace.name}</span>
    <div class="spacer"></div>
    <SettingsMenu />
    <ModulePicker />
    <button
      class="zen-btn"
      onclick={() => zen.toggle()}
      title="Focus mode (⌘⇧F)"
      aria-label="Toggle focus mode"
    >⊡</button>
  </header>

  <main>
    {#if workspace.loaded}
      <Dashboard />
    {/if}
  </main>

  {#if zen.active}
    <div class="zen-bar">
      <button onclick={() => zen.toggle()}>exit focus · ⌘⇧F</button>
    </div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    flex-shrink: 0;
    overflow: hidden;
    max-height: 4rem;
    transition:
      max-height 0.25s ease,
      padding 0.22s ease,
      opacity 0.18s ease,
      border-color 0.18s ease;
  }

  .topbar.zen-hidden {
    max-height: 0;
    padding-top: 0;
    padding-bottom: 0;
    opacity: 0;
    border-bottom-color: transparent;
  }

  .logo {
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .divider {
    color: var(--text-dim);
  }

  .workspace {
    color: var(--text-dim);
    font-size: 0.9rem;
  }

  .spacer {
    flex: 1;
  }

  .zen-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 1rem;
    line-height: 1;
    padding: 0.2rem 0.35rem;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .zen-btn:hover {
    color: var(--accent);
    border-color: var(--border);
  }

  main {
    flex: 1;
    overflow: auto;
    padding: 1rem;
    transition: padding 0.25s ease;
  }

  .app.zen main {
    padding: 0;
  }

  /* Exit hint — invisible until hovered, briefly visible after entering zen */
  .zen-bar {
    position: fixed;
    bottom: 1.25rem;
    right: 1.25rem;
    z-index: 1000;
  }

  .zen-bar button {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 0.72rem;
    font-family: inherit;
    padding: 0.3rem 0.65rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s, color 0.15s;
    animation: zen-peek 4s ease-out forwards;
  }

  .zen-bar:hover button {
    opacity: 1;
    animation: none;
  }

  .zen-bar button:hover {
    color: var(--accent);
  }

  @keyframes zen-peek {
    0%   { opacity: 0; }
    12%  { opacity: 0.75; }
    65%  { opacity: 0.75; }
    100% { opacity: 0; }
  }
</style>
