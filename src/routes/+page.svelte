<script lang="ts">
  import { onMount } from "svelte";
  import Dashboard from "$lib/components/Dashboard.svelte";
  import ModulePicker from "$lib/components/ModulePicker.svelte";
  import { workspace } from "$lib/core/workspace.svelte";
  import { registerBuiltinModules } from "$lib/modules";

  registerBuiltinModules();

  onMount(() => {
    void workspace.load();
  });
</script>

<div class="app">
  <header class="topbar">
    <span class="logo">fieldnotes</span>
    <span class="divider">/</span>
    <span class="workspace">{workspace.name}</span>
    <div class="spacer"></div>
    <ModulePicker />
  </header>

  <main>
    {#if workspace.loaded}
      <Dashboard />
    {/if}
  </main>
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

  main {
    flex: 1;
    overflow: auto;
    padding: 1rem;
  }
</style>
