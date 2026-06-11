/**
 * Pure grid-layout math for the auto-packing dashboard (gridstack-style,
 * vertical compaction). No DOM, no state — fully unit-testable.
 */
import type { GridRect, ModuleInstance } from "./types";

export const COLS = 12;

export function collides(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Keep a rect inside the column bounds and above its minimum size. */
export function clampRect(rect: GridRect, minW = 1, minH = 1): GridRect {
  const w = Math.max(minW, Math.min(rect.w, COLS));
  const x = Math.max(0, Math.min(rect.x, COLS - w));
  const y = Math.max(0, rect.y);
  const h = Math.max(minH, rect.h);
  return { x, y, w, h };
}

/** Total rows occupied (for sizing the container). */
export function contentHeight(items: ModuleInstance[]): number {
  return items.reduce((max, it) => Math.max(max, it.position.y + it.position.h), 0);
}

/**
 * Gravity: every item floats up until it would overlap another.
 * `pinnedId` (if given) stays exactly where it is and acts as an obstacle —
 * used while dragging so the dragged item doesn't jump around.
 */
export function packUp(items: ModuleInstance[], pinnedId: string | null = null): ModuleInstance[] {
  const result = items.map((it) => ({ ...it, position: { ...it.position } }));
  const sorted = [...result].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );
  const placed: GridRect[] = [];
  const pinned = pinnedId ? result.find((it) => it.instanceId === pinnedId) : undefined;
  if (pinned) placed.push(pinned.position);

  for (const item of sorted) {
    if (item.instanceId === pinnedId) continue;
    while (item.position.y > 0) {
      const probe = { ...item.position, y: item.position.y - 1 };
      if (placed.some((p) => collides(probe, p))) break;
      item.position.y -= 1;
    }
    placed.push(item.position);
  }
  return result;
}

/**
 * Place one item at a target rect (move or resize), push anything it now
 * overlaps downward (cascading), then re-pack. Returns a new array.
 */
export function applyRect(
  items: ModuleInstance[],
  instanceId: string,
  target: GridRect,
  minW = 1,
  minH = 1,
): ModuleInstance[] {
  const next = items.map((it) =>
    it.instanceId === instanceId
      ? { ...it, position: clampRect(target, minW, minH) }
      : { ...it, position: { ...it.position } },
  );
  const moved = next.find((it) => it.instanceId === instanceId);
  if (!moved) return items;

  pushDown(next, moved);
  return packUp(next, instanceId);
}

function pushDown(items: ModuleInstance[], mover: ModuleInstance): void {
  for (const other of items) {
    if (other.instanceId === mover.instanceId) continue;
    if (collides(mover.position, other.position)) {
      other.position.y = mover.position.y + mover.position.h;
      pushDown(items, other);
    }
  }
}

/** First open spot scanning top-to-bottom, left-to-right. */
export function findFreeSpot(items: ModuleInstance[], w: number, h: number): GridRect {
  const width = Math.min(w, COLS);
  for (let y = 0; ; y++) {
    for (let x = 0; x <= COLS - width; x++) {
      const probe = { x, y, w: width, h };
      if (!items.some((it) => collides(probe, it.position))) return probe;
    }
  }
}
