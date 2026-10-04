<script lang="ts">
  import { onMount } from "svelte";
  import Dashboard from "$lib/components/Dashboard.svelte";
  import DropOverlay from "$lib/components/DropOverlay.svelte";
  import LayoutMenu from "$lib/components/LayoutMenu.svelte";
  import ModulePicker from "$lib/components/ModulePicker.svelte";
  import Toasts from "$lib/components/Toasts.svelte";
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
    {#if workspace.loaded}<LayoutMenu />{/if}
    <div class="spacer"></div>
    <ModulePicker />
  </header>

  <main>
    {#if workspace.loaded}
      <Dashboard />
    {/if}
  </main>
</div>

<DropOverlay />
<Toasts />

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

  .spacer {
    flex: 1;
  }

  main {
    flex: 1;
    overflow: auto;
    padding: 1rem;
  }
</style>
