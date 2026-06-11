<script lang="ts">
  import { COLS } from "$lib/core/grid";
  import { getModule } from "$lib/core/registry";
  import { workspace } from "$lib/core/workspace.svelte";
  import type { GridRect, ModuleInstance } from "$lib/core/types";
  import ModuleFrame from "./ModuleFrame.svelte";

  const ROW_H = 72;
  const GAP = 12;

  let gridWidth = $state(0);
  const colW = $derived(gridWidth > 0 ? (gridWidth - GAP * (COLS - 1)) / COLS : 0);

  interface PxRect {
    left: number;
    top: number;
    width: number;
    height: number;
  }

  interface DragState {
    instanceId: string;
    kind: "move" | "resize";
    pointerStart: { x: number; y: number };
    startPx: PxRect;
    px: PxRect;
  }

  let drag = $state<DragState | null>(null);

  function toPx(rect: GridRect): PxRect {
    return {
      left: rect.x * (colW + GAP),
      top: rect.y * (ROW_H + GAP),
      width: rect.w * colW + (rect.w - 1) * GAP,
      height: rect.h * ROW_H + (rect.h - 1) * GAP,
    };
  }

  function rectOf(instanceId: string): GridRect | undefined {
    return workspace.instances.find((it) => it.instanceId === instanceId)?.position;
  }

  function startDrag(e: PointerEvent, inst: ModuleInstance, kind: "move" | "resize"): void {
    if (colW <= 0 || drag) return;
    e.preventDefault();
    const startPx = toPx(inst.position);
    drag = {
      instanceId: inst.instanceId,
      kind,
      pointerStart: { x: e.clientX, y: e.clientY },
      startPx,
      px: { ...startPx },
    };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    const dx = e.clientX - drag.pointerStart.x;
    const dy = e.clientY - drag.pointerStart.y;
    const current = rectOf(drag.instanceId);
    if (!current) return;

    let target: GridRect;
    if (drag.kind === "move") {
      drag.px = {
        ...drag.px,
        left: drag.startPx.left + dx,
        top: drag.startPx.top + dy,
      };
      target = {
        ...current,
        x: Math.round(drag.px.left / (colW + GAP)),
        y: Math.round(drag.px.top / (ROW_H + GAP)),
      };
    } else {
      drag.px = {
        ...drag.px,
        width: Math.max(colW, drag.startPx.width + dx),
        height: Math.max(ROW_H, drag.startPx.height + dy),
      };
      target = {
        ...current,
        w: Math.round((drag.px.width + GAP) / (colW + GAP)),
        h: Math.round((drag.px.height + GAP) / (ROW_H + GAP)),
      };
    }

    if (
      target.x !== current.x ||
      target.y !== current.y ||
      target.w !== current.w ||
      target.h !== current.h
    ) {
      workspace.setRect(drag.instanceId, target);
    }
  }

  function endDrag(): void {
    if (!drag) return;
    drag = null;
    workspace.commit();
  }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={endDrag} onpointercancel={endDrag} />

<div
  class="grid"
  class:interacting={drag !== null}
  bind:clientWidth={gridWidth}
  style:height={`${Math.max(workspace.rows, 4) * (ROW_H + GAP) + GAP}px`}
>
  {#if drag}
    {@const landing = rectOf(drag.instanceId)}
    {#if landing}
      {@const g = toPx(landing)}
      <div
        class="ghost"
        style:left={`${g.left}px`}
        style:top={`${g.top}px`}
        style:width={`${g.width}px`}
        style:height={`${g.height}px`}
      ></div>
    {/if}
  {/if}

  {#each workspace.instances as inst (inst.instanceId)}
    {@const def = getModule(inst.moduleId)}
    {#if def}
      {@const active = drag?.instanceId === inst.instanceId}
      {@const px = active && drag ? drag.px : toPx(inst.position)}
      <div
        class="cell"
        class:active
        style:left={`${px.left}px`}
        style:top={`${px.top}px`}
        style:width={`${px.width}px`}
        style:height={`${px.height}px`}
      >
        <ModuleFrame
          {def}
          instance={inst}
          onmovestart={(e) => startDrag(e, inst, "move")}
          onresizestart={(e) => startDrag(e, inst, "resize")}
          onclose={() => workspace.remove(inst.instanceId)}
        />
      </div>
    {/if}
  {/each}

  {#if workspace.instances.length === 0}
    <div class="empty">
      <p>Nothing here yet.</p>
      <p class="hint">Use “Add module” to place your first module.</p>
    </div>
  {/if}
</div>

<style>
  .grid {
    position: relative;
  }

  .grid.interacting {
    cursor: grabbing;
    user-select: none;
    -webkit-user-select: none;
  }

  .cell {
    position: absolute;
    transition:
      left 0.18s ease,
      top 0.18s ease,
      width 0.18s ease,
      height 0.18s ease;
  }

  .cell.active {
    transition: none;
    z-index: 20;
    opacity: 0.92;
  }

  .ghost {
    position: absolute;
    z-index: 1;
    border: 2px dashed var(--accent);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    transition:
      left 0.18s ease,
      top 0.18s ease,
      width 0.18s ease,
      height 0.18s ease;
  }

  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    text-align: center;
    color: var(--text-dim);
  }

  .empty p {
    margin: 0.2rem 0;
  }

  .empty .hint {
    font-size: 0.85rem;
  }
</style>
