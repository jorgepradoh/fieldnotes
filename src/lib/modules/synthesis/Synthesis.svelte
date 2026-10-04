<script lang="ts">
  import { tick } from "svelte";
  import { aiSettings } from "$lib/ai/settings.svelte";
  import {
    DEPTHS,
    authorLine,
    briefToMarkdown,
    buildBrief,
    estimateTokens,
    visibleText,
    type Depth,
  } from "$lib/ai/prompt";
  import { PRESETS, getPreset, newProfile, profileProblem, type ProviderPreset } from "$lib/ai/profiles";
  import { createProvider } from "$lib/ai/providers";
  import { LlmError, type ProviderProfile } from "$lib/ai/types";
  import Markdown from "$lib/components/Markdown.svelte";
  import { emit, latest, on } from "$lib/core/bus.svelte";
  import { copyText, saveTextFile } from "$lib/core/files";
  import { isAbortError } from "$lib/core/net";
  import { toast } from "$lib/core/toast.svelte";
  import type { ModuleInstance } from "$lib/core/types";
  import { workspace } from "$lib/core/workspace.svelte";
  import type { Paper } from "$lib/sources/types";

  let { instance }: { instance: ModuleInstance } = $props();

  interface SavedBrief {
    topic: string;
    text: string;
    papers: Paper[];
    model: string;
    at: number;
    stopReason: string | null;
    notice?: string;
  }

  // Settings hydrate initial state once; edits flow back via updateSettings.
  // svelte-ignore state_referenced_locally
  const initial = instance.settings;
  let profileId = $state(String(initial.profileId ?? ""));
  let depth = $state<Depth>(DEPTHS.some((d) => d.id === initial.depth) ? (initial.depth as Depth) : "standard");
  let topN = $state(Math.min(30, Math.max(1, Number(initial.topN) || 10)));
  let focus = $state(String(initial.focus ?? ""));
  let excluded = $state<string[]>(Array.isArray(initial.excluded) ? (initial.excluded as string[]) : []);
  let brief = $state.raw<SavedBrief | null>((initial.brief as SavedBrief | undefined) ?? null);

  let view = $state<"main" | "settings">("main");
  let status = $state<"idle" | "running">("idle");
  let output = $state("");
  let error = $state("");
  let notice = $state("");
  let stopReason = $state<string | null>(null);
  let usedModel = $state("");
  /** The papers behind the request in flight, so [n] markers stay valid if the selection changes meanwhile. */
  let runPapers = $state.raw<Paper[]>([]);
  let showPapers = $state(false);
  let outputEl: HTMLDivElement | undefined = $state();
  let stick = true;
  let controller: AbortController | null = null;

  // ------------------------------------------------------------- corpus
  let results = $state.raw<{ query: string; papers: Paper[] } | null>(latest("search:results") ?? null);
  $effect(() => on("search:results", (r) => (results = r)));

  const excludedSet = $derived(new Set(excluded));
  const candidates = $derived.by(() => {
    const out: { paper: Paper; on: boolean }[] = [];
    let taken = 0;
    for (const paper of results?.papers ?? []) {
      const on = !excludedSet.has(paper.id);
      if (on) {
        if (taken >= topN) break;
        taken++;
      }
      out.push({ paper, on });
    }
    return out;
  });
  const included = $derived(candidates.filter((c) => c.on).map((c) => c.paper));
  const withoutAbstract = $derived(included.filter((p) => !p.abstract && !p.tldr).length);

  // ------------------------------------------------------------ profile
  void aiSettings.ensureLoaded();
  const profile = $derived(aiSettings.resolve(profileId));
  const problem = $derived(aiSettings.loaded ? profileProblem(profile) : null);

  const prompt = $derived(buildBrief({ topic: results?.query ?? "", focus, depth, papers: included }));
  const promptTokens = $derived(estimateTokens(prompt.system, prompt.user));
  const isLocal = $derived(
    !!profile && profile.kind === "openai-compatible" && /\/\/(localhost|127\.0\.0\.1)/.test(profile.baseUrl),
  );

  const shownText = $derived(status === "running" ? visibleText(output) : (brief?.text ?? ""));
  const shownPapers = $derived(status === "running" ? runPapers : (brief?.papers ?? []));

  function persist(patch: Record<string, unknown>): void {
    workspace.updateSettings(instance.instanceId, patch);
  }

  function toggleExcluded(id: string, on: boolean): void {
    excluded = on ? excluded.filter((x) => x !== id) : [...excluded, id];
    persist({ excluded: $state.snapshot(excluded) });
  }

  // --------------------------------------------------------- generation
  async function generate(): Promise<void> {
    const p = profile;
    if (!p || problem) {
      error = problem ?? "Set up a model first.";
      view = "settings";
      return;
    }
    if (included.length === 0) return;

    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    status = "running";
    error = "";
    notice = "";
    output = "";
    stopReason = null;
    usedModel = p.model;
    stick = true;

    const papers = included;
    const topic = results?.query ?? "";
    runPapers = papers;
    const request = prompt;
    try {
      for await (const ev of createProvider(p).stream({
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        signal: mine.signal,
      })) {
        if (ev.type === "text") {
          output += ev.text;
        } else {
          stopReason = ev.stopReason;
          if (ev.model) usedModel = ev.model;
          notice = ev.notice ?? "";
        }
      }
      const text = visibleText(output);
      if (!text.trim()) {
        error = "The model returned an empty answer. Try again, or pick a different model.";
        return;
      }
      brief = { topic, text, papers, model: usedModel, at: Date.now(), stopReason, notice: notice || undefined };
      persist({ brief: $state.snapshot(brief), profileId: profile?.id ?? profileId });
    } catch (err) {
      if (isAbortError(err)) {
        // Stopped by the user: keep what has streamed so far as the (partial) result.
        const text = visibleText(output);
        if (text.trim()) {
          brief = { topic, text, papers, model: usedModel, at: Date.now(), stopReason: "stopped" };
          persist({ brief: $state.snapshot(brief) });
        }
        return;
      }
      error = err instanceof Error ? err.message : String(err);
      // A partial answer cut off by a refusal must not be mistaken for a finished brief.
      if (!(err instanceof LlmError && err.kind === "refusal") && visibleText(output).trim()) {
        brief = { topic, text: visibleText(output), papers, model: usedModel, at: Date.now(), stopReason: "error" };
      }
    } finally {
      if (controller === mine) {
        status = "idle";
        output = "";
      }
    }
  }

  function stop(): void {
    controller?.abort();
  }

  $effect(() => {
    void output;
    if (status === "running" && stick && outputEl) {
      void tick().then(() => outputEl && (outputEl.scrollTop = outputEl.scrollHeight));
    }
  });

  function onOutputScroll(): void {
    if (!outputEl) return;
    stick = outputEl.scrollTop + outputEl.clientHeight >= outputEl.scrollHeight - 40;
  }

  function openPaper(n: number): void {
    const paper = shownPapers[n - 1];
    if (paper) emit("paper:selected", { paper });
  }

  async function copyBrief(): Promise<void> {
    if (!brief) return;
    toast((await copyText(briefToMarkdown(brief))) ? "Brief copied as markdown." : "Could not copy to the clipboard.", "info");
  }

  async function saveBrief(): Promise<void> {
    if (!brief) return;
    const slug =
      brief.topic
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "brief";
    try {
      if ((await saveTextFile(`${slug}.brief.md`, briefToMarkdown(brief), "text/markdown")) === "saved") {
        toast("Brief saved.", "success");
      }
    } catch (err) {
      toast(`Could not save: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  function truncatedNote(reason: string | null): string {
    if (reason === "max_tokens" || reason === "length") {
      return "The answer hit the output limit and was cut off. Raise “Max output tokens” in the model settings.";
    }
    if (reason === "content_filter") return "The provider’s content filter stopped the answer early.";
    if (reason === "stopped") return "Stopped early.";
    if (reason === "error") return "Interrupted by an error — this is only the part that arrived.";
    return "";
  }

  // ------------------------------------------------------- settings view
  let editId = $state("");
  let draft = $state<ProviderProfile | null>(null);
  let adding = $state(false);
  let models = $state<string[]>([]);
  let modelsStatus = $state<"idle" | "loading" | "error">("idle");
  let modelsError = $state("");
  let confirmDelete = $state(false);

  function openSettings(): void {
    view = "settings";
    const target = profile?.id ?? aiSettings.profiles[0]?.id ?? "";
    adding = aiSettings.profiles.length === 0;
    selectForEdit(target);
  }

  function selectForEdit(id: string): void {
    editId = id;
    const found = aiSettings.get(id);
    draft = found ? { ...found } : null;
    models = [];
    modelsStatus = "idle";
    modelsError = "";
    confirmDelete = false;
  }

  function commit(): void {
    if (!draft) return;
    const maxTokens = Math.min(200_000, Math.max(256, Math.round(Number(draft.maxTokens)) || 4096));
    const clean: ProviderProfile = {
      ...$state.snapshot(draft),
      name: draft.name.trim() || "Model",
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      maxTokens,
    };
    draft = clean;
    aiSettings.update(clean);
  }

  function addFromPreset(preset: ProviderPreset): void {
    const created = newProfile(preset);
    aiSettings.add(created);
    adding = false;
    selectForEdit(created.id);
    profileId = created.id;
    persist({ profileId });
  }

  function useProfile(id: string): void {
    profileId = id;
    persist({ profileId: id });
  }

  function removeProfile(): void {
    if (!draft) return;
    aiSettings.remove(draft.id);
    if (profileId === draft.id) {
      profileId = aiSettings.activeId;
      persist({ profileId });
    }
    selectForEdit(aiSettings.activeId);
    adding = aiSettings.profiles.length === 0;
  }

  async function loadModels(): Promise<void> {
    if (!draft) return;
    commit();
    modelsStatus = "loading";
    modelsError = "";
    try {
      models = await createProvider(draft).listModels();
      modelsStatus = "idle";
      if (models.length === 0) modelsError = "The server listed no models.";
    } catch (err) {
      modelsStatus = "error";
      modelsError = err instanceof Error ? err.message : String(err);
    }
  }

  const presetHint = $derived.by(() => {
    if (!draft) return "";
    const match = PRESETS.find((p) => p.baseUrl && p.baseUrl === draft?.baseUrl);
    return (match ?? getPreset(draft.kind === "anthropic" ? "anthropic" : "custom"))?.hint ?? "";
  });
</script>

<div class="synth">
  {#if view === "settings"}
    <div class="settings">
      <div class="bar">
        <strong>Model settings</strong>
        <span class="grow"></span>
        <button class="primary" onclick={() => (view = "main")} disabled={aiSettings.profiles.length === 0}>Done</button>
      </div>

      {#if aiSettings.profiles.length > 0}
        <div class="row">
          <label class="grow">
            Profile
            <select value={editId} onchange={(e) => selectForEdit(e.currentTarget.value)}>
              {#each aiSettings.profiles as p (p.id)}
                <option value={p.id}>{p.name} — {p.model || "no model"}</option>
              {/each}
            </select>
          </label>
          <button type="button" onclick={() => (adding = !adding)} aria-expanded={adding}>＋ Add</button>
        </div>
      {:else}
        <p class="intro">
          Pick where the briefing is written. Use Claude, OpenAI, or any OpenAI-compatible server — including
          models running on your own machine.
        </p>
      {/if}

      {#if adding}
        <ul class="presets">
          {#each PRESETS as preset (preset.id)}
            <li>
              <button type="button" onclick={() => addFromPreset(preset)}>
                <strong>{preset.label}</strong>
                <small>{preset.needsKey ? "API key" : "no key needed"}</small>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if draft}
        <label>
          Name
          <input bind:value={draft.name} onchange={commit} />
        </label>
        <label>
          Base URL
          <input bind:value={draft.baseUrl} onchange={commit} placeholder="https://…/v1" autocomplete="off" spellcheck="false" />
        </label>
        <label>
          API key {#if draft.kind === "openai-compatible"}<small>(leave empty for local servers)</small>{/if}
          <input type="password" bind:value={draft.apiKey} onchange={commit} placeholder="none" autocomplete="off" />
        </label>
        <label>
          Model
          <span class="row">
            <input
              class="grow"
              list={`models-${instance.instanceId}`}
              bind:value={draft.model}
              onchange={commit}
              placeholder={draft.kind === "anthropic" ? "claude-opus-5-5" : "load models, or type an id"}
              autocomplete="off"
              spellcheck="false"
            />
            <button type="button" onclick={() => void loadModels()} disabled={modelsStatus === "loading"}>
              {modelsStatus === "loading" ? "…" : "Load models"}
            </button>
          </span>
          <datalist id={`models-${instance.instanceId}`}>
            {#each models as m (m)}<option value={m}></option>{/each}
          </datalist>
        </label>
        {#if modelsStatus === "error" || modelsError}
          <p class="error">{modelsError}</p>
        {:else if models.length > 0}
          <p class="ok">Connected — {models.length} models available (see the Model field’s suggestions).</p>
        {/if}
        <label>
          Max output tokens
          <input type="number" min="256" max="200000" step="256" bind:value={draft.maxTokens} onchange={commit} />
        </label>
        {#if draft.kind === "anthropic"}
          <label class="check">
            <input
              type="checkbox"
              checked={draft.refusalFallback !== false}
              onchange={(e) => {
                if (draft) draft.refusalFallback = e.currentTarget.checked;
                commit();
              }}
            />
            If the safeguards decline a request, re-run it on a fallback model
          </label>
        {:else}
          <label>
            Output-limit parameter <small>(auto works for most servers)</small>
            <select
              value={draft.tokenParam ?? "auto"}
              onchange={(e) => {
                if (draft) draft.tokenParam = e.currentTarget.value as NonNullable<ProviderProfile["tokenParam"]>;
                commit();
              }}
            >
              <option value="auto">auto</option>
              <option value="max_tokens">max_tokens</option>
              <option value="max_completion_tokens">max_completion_tokens</option>
            </select>
          </label>
        {/if}
        {#if presetHint}<p class="hint">{presetHint}</p>{/if}
        <p class="fine">
          Stored on this machine in plain text and never included in layout exports. Requests go straight from this
          app to the base URL above.
        </p>

        <div class="row">
          {#if confirmDelete}
            <span class="grow">Delete “{draft.name}”?</span>
            <button type="button" class="danger" onclick={removeProfile}>Delete</button>
            <button type="button" onclick={() => (confirmDelete = false)}>Keep</button>
          {:else}
            <button type="button" onclick={() => confirmDelete = true}>Delete profile</button>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="main">
      <div class="row top">
        {#if aiSettings.profiles.length > 1}
          <select
            class="grow"
            value={profile?.id}
            onchange={(e) => useProfile(e.currentTarget.value)}
            aria-label="Model profile"
          >
            {#each aiSettings.profiles as p (p.id)}
              <option value={p.id}>{p.name} · {p.model || "no model"}</option>
            {/each}
          </select>
        {:else}
          <span class="grow model" title={profile?.baseUrl}>
            {profile ? `${profile.name} · ${profile.model || "no model"}` : "No model set up"}
          </span>
        {/if}
        <button type="button" class="gear" onclick={openSettings} aria-label="Model settings" title="Model settings">⚙</button>
      </div>

      {#if aiSettings.loaded && problem && !profile}
        <div class="setup">
          <p>Set up a model to write briefings.</p>
          <button class="primary" onclick={openSettings}>Set up a model</button>
        </div>
      {:else if !results || results.papers.length === 0}
        <p class="empty">
          Run a search in <strong>Paper Search</strong> and the top results appear here, ready to be turned into a
          cited briefing.
        </p>
      {:else}
        <div class="corpus">
          <div class="row">
            <span class="grow">
              From search <q>{results.query}</q>
            </span>
            <label class="inline">
              Papers
              <input
                type="number"
                min="1"
                max="30"
                bind:value={topN}
                onchange={() => {
                  topN = Math.min(30, Math.max(1, Math.round(Number(topN)) || 10));
                  persist({ topN });
                }}
              />
            </label>
            <label class="inline">
              Length
              <select bind:value={depth} onchange={() => persist({ depth })}>
                {#each DEPTHS as d (d.id)}<option value={d.id} title={d.hint}>{d.label}</option>{/each}
              </select>
            </label>
          </div>
          <input
            class="focus"
            bind:value={focus}
            onchange={() => persist({ focus: focus.trim() })}
            placeholder="Focus (optional) — e.g. “safety and evaluation”"
            aria-label="Focus"
          />
          <button type="button" class="link" onclick={() => (showPapers = !showPapers)} aria-expanded={showPapers}>
            {showPapers ? "▾" : "▸"} {included.length} papers included · ≈{promptTokens.toLocaleString()} tokens in
          </button>
          {#if showPapers}
            <ul class="papers">
              {#each candidates as c (c.paper.id)}
                <li>
                  <label>
                    <input type="checkbox" checked={c.on} onchange={(e) => toggleExcluded(c.paper.id, e.currentTarget.checked)} />
                    <span>{c.paper.title}<small> {authorLine(c.paper, 1)}{c.paper.year ? `, ${c.paper.year}` : ""}</small></span>
                  </label>
                </li>
              {/each}
            </ul>
          {/if}
          {#if withoutAbstract > 0}
            <p class="fine">{withoutAbstract} of these have no abstract, so the model only has their titles.</p>
          {/if}
          {#if isLocal && promptTokens > 6000}
            <p class="fine warn">
              ≈{promptTokens.toLocaleString()} tokens is more than many local models’ default context. If the answer looks
              cut off or off-topic, lower the paper count or raise the model’s context length.
            </p>
          {/if}
          <div class="row">
            {#if status === "running"}
              <button class="primary" onclick={stop}>■ Stop</button>
              <span class="dim">Writing with {usedModel}…</span>
            {:else}
              <button class="primary" onclick={() => void generate()} disabled={included.length === 0 || !aiSettings.loaded}>
                {brief ? "Regenerate brief" : "Write brief"}
              </button>
              {#if problem}<span class="dim">{problem}</span>{/if}
            {/if}
          </div>
        </div>
      {/if}

      {#if error}
        <p class="error">{error}</p>
      {/if}
      {#if notice && status === "idle"}
        <p class="info">{notice}</p>
      {/if}

      {#if shownText}
        <div class="output" bind:this={outputEl} onscroll={onOutputScroll}>
          <Markdown source={shownText} citations={shownPapers.length} oncite={openPaper} />
          {#if status === "idle" && brief}
            {#if truncatedNote(brief.stopReason)}<p class="warn">{truncatedNote(brief.stopReason)}</p>{/if}
            <h4>Sources</h4>
            <ol class="refs">
              {#each brief.papers as p, i (p.id)}
                <li>
                  <button type="button" onclick={() => openPaper(i + 1)}>
                    {p.title}<small> — {authorLine(p, 2)}{p.year ? `, ${p.year}` : ""}</small>
                  </button>
                </li>
              {/each}
            </ol>
            <p class="fine">
              {#if brief.topic}Brief on “{brief.topic}” · {/if}written by {brief.model} from {brief.papers.length} abstracts on
              {new Date(brief.at).toLocaleDateString()}. AI-generated — verify claims against the papers.
            </p>
          {/if}
        </div>
        {#if status === "idle" && brief}
          <div class="row actions">
            <button type="button" onclick={() => void copyBrief()}>Copy markdown</button>
            <button type="button" onclick={() => void saveBrief()}>Save .md</button>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .synth,
  .main,
  .settings {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .synth {
    height: 100%;
  }

  .main,
  .settings {
    flex: 1;
    padding: 0.6rem;
    gap: 0.5rem;
    overflow: auto;
  }

  .main {
    overflow: hidden;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  input,
  select,
  button {
    font-size: 0.8rem;
  }

  input:not([type="checkbox"]),
  select {
    min-width: 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 0.35rem 0.55rem;
    outline: none;
  }

  input:focus,
  select:focus {
    border-color: var(--accent);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.74rem;
    color: var(--text-dim);
  }

  label.check {
    flex-direction: row;
    align-items: center;
    gap: 0.45rem;
  }

  label.inline {
    flex-direction: row;
    align-items: center;
    gap: 0.35rem;
  }

  label.inline input[type="number"] {
    width: 3.6rem;
  }

  button {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 0.35rem 0.7rem;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: var(--accent);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #0e1018;
    font-weight: 600;
  }

  button.danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 50%, transparent);
  }

  button.link {
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 0;
    text-align: left;
  }

  button.link:hover {
    color: var(--text);
  }

  .gear {
    color: var(--text-dim);
    padding: 0.3rem 0.55rem;
  }

  .model {
    font-size: 0.78rem;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .top {
    flex-shrink: 0;
    flex-wrap: nowrap;
  }

  .corpus {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex-shrink: 0;
    font-size: 0.78rem;
  }

  .corpus q {
    font-style: italic;
  }

  .focus {
    width: 100%;
  }

  .papers {
    list-style: none;
    margin: 0;
    padding: 0.3rem 0.5rem;
    max-height: 9rem;
    overflow: auto;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .papers label {
    flex-direction: row;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.15rem 0;
    color: var(--text);
    font-size: 0.74rem;
  }

  .papers small,
  .refs small {
    color: var(--text-dim);
  }

  .presets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.35rem;
  }

  .presets button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    gap: 0.1rem;
  }

  .presets small {
    color: var(--text-dim);
    font-size: 0.68rem;
  }

  .intro,
  .empty,
  .setup p {
    margin: 0;
    color: var(--text-dim);
    font-size: 0.8rem;
    line-height: 1.45;
  }

  .empty,
  .setup {
    margin: auto;
    text-align: center;
    max-width: 90%;
  }

  .setup {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
  }

  .dim {
    color: var(--text-dim);
    font-size: 0.74rem;
  }

  .hint,
  .fine {
    margin: 0;
    font-size: 0.7rem;
    line-height: 1.4;
    color: var(--text-dim);
  }

  .warn {
    color: #e0af68;
  }

  .ok {
    margin: 0;
    font-size: 0.72rem;
    color: #9ece6a;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 0.78rem;
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    border-radius: 8px;
    padding: 0.45rem 0.6rem;
    line-height: 1.4;
  }

  .info {
    margin: 0;
    font-size: 0.76rem;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-radius: 8px;
    padding: 0.4rem 0.6rem;
  }

  .output {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.2rem 0.3rem 0.5rem;
    border-top: 1px solid var(--border);
  }

  .output h4 {
    margin: 1rem 0 0.3rem;
    font-size: 0.8rem;
  }

  .refs {
    margin: 0;
    padding-left: 1.3rem;
    font-size: 0.76rem;
  }

  .refs button {
    background: none;
    border: none;
    padding: 0.1rem 0;
    text-align: left;
    color: var(--text);
  }

  .refs button:hover {
    color: var(--accent);
  }

  .actions {
    flex-shrink: 0;
  }
</style>
