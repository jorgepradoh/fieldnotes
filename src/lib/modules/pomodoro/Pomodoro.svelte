<script lang="ts">
  import { emit } from "$lib/core/bus.svelte";
  import { workspace } from "$lib/core/workspace.svelte";
  import type { ModuleInstance } from "$lib/core/types";

  let { instance }: { instance: ModuleInstance } = $props();

  // Settings hydrate initial state once; edits flow back via updateSettings.
  // svelte-ignore state_referenced_locally
  const initial = instance.settings;
  let workMin = $state(Number(initial.workMin ?? 25));
  let breakMin = $state(Number(initial.breakMin ?? 5));
  let phase = $state<"work" | "break">("work");
  let remaining = $state(Number(initial.workMin ?? 25) * 60);
  let running = $state(false);

  const minutes = $derived(String(Math.floor(remaining / 60)).padStart(2, "0"));
  const seconds = $derived(String(remaining % 60).padStart(2, "0"));

  const R = 40;
  const CIRC = 2 * Math.PI * R; // ≈ 251.33
  const totalSeconds = $derived((phase === "work" ? workMin : breakMin) * 60);
  const dashoffset = $derived(CIRC * (1 - remaining / totalSeconds));

  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        phase = phase === "work" ? "break" : "work";
        remaining = (phase === "work" ? workMin : breakMin) * 60;
        emit("pomodoro:phase", { phase });
      }
    }, 1000);
    return () => clearInterval(timer);
  });

  function reset(): void {
    running = false;
    phase = "work";
    remaining = workMin * 60;
  }

  function saveDurations(): void {
    workspace.updateSettings(instance.instanceId, { workMin, breakMin });
  }
</script>

<div class="pomodoro" class:break={phase === "break"}>
  <div class="ring-wrap">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="track" cx="50" cy="50" r={R} />
      <circle
        class="fill"
        cx="50"
        cy="50"
        r={R}
        stroke-dasharray={CIRC}
        stroke-dashoffset={dashoffset}
        transform="rotate(-90 50 50)"
      />
    </svg>
    <div class="center">
      <span class="phase">{phase === "work" ? "Focus" : "Break"}</span>
      <span class="time">{minutes}:{seconds}</span>
    </div>
  </div>

  <div class="controls">
    <button class="primary" onclick={() => (running = !running)}>
      {running ? "Pause" : "Start"}
    </button>
    <button onclick={reset}>Reset</button>
  </div>
  <div class="durations">
    <label>
      Work
      <input type="number" min="1" max="120" bind:value={workMin} onchange={saveDurations} />
    </label>
    <label>
      Break
      <input type="number" min="1" max="60" bind:value={breakMin} onchange={saveDurations} />
    </label>
  </div>
</div>

<style>
  .pomodoro {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    height: 100%;
    padding: 0.75rem;
  }

  .ring-wrap {
    position: relative;
    width: min(100%, 160px);
    aspect-ratio: 1;
    flex-shrink: 1;
    min-height: 0;
  }

  svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .track {
    fill: none;
    stroke: var(--surface-2);
    stroke-width: 7;
  }

  .fill {
    fill: none;
    stroke: var(--accent);
    stroke-width: 7;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.9s linear;
  }

  .break .fill {
    stroke: #9ece6a;
  }

  .center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
  }

  .phase {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
  }

  .break .phase {
    color: #9ece6a;
  }

  .time {
    font-size: 1.8rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .controls {
    display: flex;
    gap: 0.4rem;
  }

  button {
    border: 1px solid var(--border);
    background: var(--surface-2);
    border-radius: 8px;
    padding: 0.3rem 0.8rem;
    font-size: 0.8rem;
    cursor: pointer;
  }

  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #0e1018;
    font-weight: 600;
  }

  .durations {
    display: flex;
    gap: 0.8rem;
  }

  label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--text-dim);
  }

  input {
    width: 3.2rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 0.15rem 0.3rem;
  }
</style>
