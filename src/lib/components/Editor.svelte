<script lang="ts">
  import { onMount } from "svelte";
  import type { EditorView } from "@codemirror/view";
  import type { Compartment, Extension } from "@codemirror/state";
  import { settings } from "$lib/core/settings.svelte";

  interface Props {
    value: string;
    onchange: (text: string) => void;
    placeholder?: string;
  }

  let { value, onchange, placeholder = "Write markdown…" }: Props = $props();

  let container: HTMLDivElement;
  let view = $state.raw<EditorView | null>(null);
  let pushing = false;

  // Held after async setup so the vim-toggle effect can reconfigure.
  let vimComp: Compartment | null = null;
  let vimFn: ((opts: { status: boolean }) => Extension) | null = null;

  onMount(() => {
    const el = container;
    let active = true;
    let localView: EditorView | null = null;

    void (async () => {
      const [
        { EditorView: CM, keymap, drawSelection, placeholder: cmPlaceholder },
        { EditorState, Compartment: Comp },
        { markdown },
        { defaultKeymap, history, historyKeymap, indentWithTab },
        { HighlightStyle, syntaxHighlighting },
        { tags },
        { vim },
      ] = await Promise.all([
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/lang-markdown"),
        import("@codemirror/commands"),
        import("@codemirror/language"),
        import("@lezer/highlight"),
        import("@replit/codemirror-vim"),
      ]);

      if (!active) return;

      vimFn = vim as (opts: { status: boolean }) => Extension;
      const comp = new Comp();
      vimComp = comp;

      const highlight = HighlightStyle.define([
        { tag: tags.heading1, color: "var(--text)", fontWeight: "700", fontSize: "1.1em" },
        { tag: tags.heading2, color: "var(--text)", fontWeight: "700" },
        { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], color: "var(--text)", fontWeight: "600" },
        { tag: tags.emphasis, fontStyle: "italic", color: "var(--text-dim)" },
        { tag: tags.strong, fontWeight: "700" },
        { tag: tags.link, color: "var(--accent)" },
        { tag: tags.url, color: "var(--accent)" },
        { tag: tags.monospace, color: "#9ece6a", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
        { tag: tags.processingInstruction, color: "var(--text-dim)" },
        { tag: tags.punctuation, color: "var(--text-dim)" },
        { tag: tags.quote, color: "var(--text-dim)", fontStyle: "italic" },
        { tag: tags.invalid, color: "var(--danger)" },
      ]);

      localView = new CM({
        state: EditorState.create({
          doc: value,
          extensions: [
            history(),
            markdown(),
            drawSelection(),
            syntaxHighlighting(highlight),
            cmPlaceholder(placeholder),
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            comp.of(settings.data.vimMode ? [vim({ status: true })] : []),
            CM.updateListener.of((update) => {
              if (update.docChanged && !pushing) {
                onchange(update.state.doc.toString());
              }
            }),
            CM.theme({
              "&": { height: "100%", background: "transparent", color: "var(--text)" },
              ".cm-scroller": {
                overflow: "auto",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.82rem",
                lineHeight: "1.6",
              },
              ".cm-content": { padding: "0.6rem", caretColor: "var(--text)" },
              "&.cm-focused": { outline: "none" },
              "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)" },
              ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
                background: "color-mix(in srgb, var(--accent) 25%, transparent) !important",
              },
              ".cm-gutters": { display: "none" },
              ".cm-placeholder": { color: "var(--text-dim)" },
              ".cm-line": { paddingLeft: "0" },
              // Vim status bar
              ".cm-panels": { background: "var(--surface-2)", borderTop: "1px solid var(--border)" },
              ".cm-vimMode": {
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.68rem",
                fontWeight: "700",
                letterSpacing: "0.08em",
                padding: "0.2rem 0.5rem",
                color: "var(--text-dim)",
                display: "inline-block",
              },
            }),
          ],
        }),
        parent: el,
      });

      if (!active) {
        localView.destroy();
        localView = null;
        return;
      }

      view = localView;
    })();

    return () => {
      active = false;
      if (localView) {
        localView.destroy();
        localView = null;
      }
      view = null;
      vimComp = null;
      vimFn = null;
    };
  });

  // Reconfigure the vim compartment when the global setting changes.
  $effect(() => {
    const enabled = !!settings.data.vimMode;
    const v = view;
    const comp = vimComp;
    const fn = vimFn;
    if (!v || !comp || !fn) return;
    v.dispatch({ effects: comp.reconfigure(enabled ? [fn({ status: true })] : []) });
  });

  // Push externally-changed value into the editor (e.g. paper switch in Annotations).
  $effect(() => {
    const v = view;
    if (!v) return;
    const newText = value;
    const current = v.state.doc.toString();
    if (current === newText) return;
    pushing = true;
    v.dispatch({ changes: { from: 0, to: current.length, insert: newText } });
    pushing = false;
  });
</script>

<div class="editor" bind:this={container}></div>

<style>
  .editor {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .editor :global(.cm-editor) {
    flex: 1;
    height: 100%;
  }

  /* Vim status bar mode label */
  .editor :global(.cm-vimMode) {
    color: var(--text-dim);
  }
</style>
