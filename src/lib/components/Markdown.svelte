<script lang="ts">
  import { linkCitations, renderSafeMarkdown } from "$lib/core/markdown";
  import { openExternal } from "$lib/core/net";

  /**
   * Renders markdown from an untrusted source (LLM output, dropped files)
   * through the sanitising renderer. `citations` > 0 turns [n] markers into
   * buttons that call `oncite(n)`.
   */
  let {
    source,
    citations = 0,
    oncite,
  }: { source: string; citations?: number; oncite?: (n: number) => void } = $props();

  const html = $derived.by(() => {
    const safe = renderSafeMarkdown(source);
    return citations > 0 ? linkCitations(safe, citations) : safe;
  });

  function onclick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    const cite = target?.closest<HTMLElement>("button[data-cite]");
    if (cite) {
      oncite?.(Number(cite.dataset.cite));
      return;
    }
    const link = target?.closest<HTMLAnchorElement>("a[href]");
    if (link) {
      // Never navigate the app window: web links go to the system browser, anchors are ignored.
      e.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (!href.startsWith("#")) void openExternal(href);
    }
  }
</script>

<!-- Links and citation markers inside are real <a>/<button> elements, so keyboard users are covered. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md" {onclick}>{@html html}</div>

<style>
  .md {
    font-size: 0.85rem;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }

  .md :global(h1),
  .md :global(h2),
  .md :global(h3),
  .md :global(h4) {
    margin: 1em 0 0.35em;
    line-height: 1.25;
  }

  .md :global(h1) {
    font-size: 1.15rem;
  }

  .md :global(h2) {
    font-size: 1rem;
    padding-bottom: 0.2em;
    border-bottom: 1px solid var(--border);
  }

  .md :global(h3) {
    font-size: 0.92rem;
  }

  .md > :global(:first-child) {
    margin-top: 0;
  }

  .md :global(p),
  .md :global(ul),
  .md :global(ol),
  .md :global(blockquote),
  .md :global(pre),
  .md :global(table) {
    margin: 0.5em 0;
  }

  .md :global(ul),
  .md :global(ol) {
    padding-left: 1.3em;
  }

  .md :global(li) {
    margin: 0.15em 0;
  }

  .md :global(a) {
    color: var(--accent);
  }

  .md :global(code) {
    background: var(--surface-2);
    padding: 0.1em 0.3em;
    border-radius: 4px;
    font-size: 0.9em;
  }

  .md :global(pre) {
    background: var(--surface-2);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    overflow: auto;
  }

  .md :global(pre code) {
    background: none;
    padding: 0;
  }

  .md :global(blockquote) {
    border-left: 3px solid var(--border);
    margin-left: 0;
    padding-left: 0.8em;
    color: var(--text-dim);
  }

  .md :global(table) {
    border-collapse: collapse;
    font-size: 0.92em;
  }

  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--border);
    padding: 0.25em 0.5em;
  }

  .md :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
  }

  .md :global(button.cite) {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  .md :global(button.cite:hover) {
    text-decoration: underline;
  }
</style>
