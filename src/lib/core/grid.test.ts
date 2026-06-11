import { describe, expect, it } from "vitest";
import { COLS, applyRect, clampRect, collides, contentHeight, findFreeSpot, packUp } from "./grid";
import type { GridRect, ModuleInstance } from "./types";

function inst(instanceId: string, position: GridRect): ModuleInstance {
  return { instanceId, moduleId: "test", position, settings: {} };
}

function rectOf(items: ModuleInstance[], id: string): GridRect {
  const found = items.find((it) => it.instanceId === id);
  if (!found) throw new Error(`missing ${id}`);
  return found.position;
}

function noOverlaps(items: ModuleInstance[]): boolean {
  return items.every((a, i) =>
    items.slice(i + 1).every((b) => !collides(a.position, b.position)),
  );
}

describe("collides", () => {
  it("detects overlap", () => {
    expect(collides({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
  });
  it("touching edges do not overlap", () => {
    expect(collides({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
    expect(collides({ x: 0, y: 0, w: 2, h: 2 }, { x: 0, y: 2, w: 2, h: 2 })).toBe(false);
  });
});

describe("clampRect", () => {
  it("keeps rect inside columns", () => {
    expect(clampRect({ x: 11, y: 0, w: 4, h: 2 })).toEqual({ x: 8, y: 0, w: 4, h: 2 });
  });
  it("enforces minimum size", () => {
    expect(clampRect({ x: 0, y: 0, w: 1, h: 1 }, 3, 2)).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });
  it("caps width at column count", () => {
    expect(clampRect({ x: 0, y: 0, w: 20, h: 1 }).w).toBe(COLS);
  });
});

describe("packUp", () => {
  it("floats items up over gaps", () => {
    const packed = packUp([inst("a", { x: 0, y: 3, w: 2, h: 2 })]);
    expect(rectOf(packed, "a").y).toBe(0);
  });
  it("stacks instead of overlapping", () => {
    const packed = packUp([
      inst("a", { x: 0, y: 0, w: 2, h: 2 }),
      inst("b", { x: 0, y: 5, w: 2, h: 2 }),
    ]);
    expect(rectOf(packed, "b").y).toBe(2);
    expect(noOverlaps(packed)).toBe(true);
  });
  it("items in different columns pack independently", () => {
    const packed = packUp([
      inst("a", { x: 0, y: 0, w: 2, h: 4 }),
      inst("b", { x: 5, y: 3, w: 2, h: 2 }),
    ]);
    expect(rectOf(packed, "b").y).toBe(0);
  });
  it("pinned item stays put and blocks others", () => {
    const packed = packUp([inst("a", { x: 0, y: 2, w: 2, h: 2 })], "a");
    expect(rectOf(packed, "a").y).toBe(2);
  });
});

describe("applyRect", () => {
  it("pushes an overlapped item down, cascading", () => {
    const items = [
      inst("a", { x: 0, y: 0, w: 2, h: 2 }),
      inst("b", { x: 0, y: 2, w: 2, h: 2 }),
      inst("c", { x: 0, y: 4, w: 2, h: 2 }),
    ];
    const next = applyRect(items, "a", { x: 0, y: 2, w: 2, h: 2 });
    expect(noOverlaps(next)).toBe(true);
    expect(rectOf(next, "a")).toEqual({ x: 0, y: 2, w: 2, h: 2 });
    expect(rectOf(next, "b").y).toBeGreaterThanOrEqual(4);
  });
  it("re-packs the space a moved item left behind", () => {
    const items = [
      inst("a", { x: 0, y: 0, w: 2, h: 2 }),
      inst("b", { x: 0, y: 2, w: 2, h: 2 }),
    ];
    const next = applyRect(items, "a", { x: 4, y: 0, w: 2, h: 2 });
    expect(rectOf(next, "b").y).toBe(0);
  });
  it("resize grows an item and displaces its neighbor", () => {
    const items = [
      inst("a", { x: 0, y: 0, w: 2, h: 2 }),
      inst("b", { x: 0, y: 2, w: 2, h: 2 }),
    ];
    const next = applyRect(items, "a", { x: 0, y: 0, w: 2, h: 3 });
    expect(rectOf(next, "b").y).toBe(3);
    expect(noOverlaps(next)).toBe(true);
  });
  it("respects minimum size", () => {
    const items = [inst("a", { x: 0, y: 0, w: 4, h: 4 })];
    const next = applyRect(items, "a", { x: 0, y: 0, w: 1, h: 1 }, 3, 2);
    expect(rectOf(next, "a")).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });
  it("does not mutate the input", () => {
    const items = [inst("a", { x: 0, y: 0, w: 2, h: 2 })];
    applyRect(items, "a", { x: 4, y: 0, w: 2, h: 2 });
    expect(items[0].position.x).toBe(0);
  });
});

describe("findFreeSpot", () => {
  it("finds the first gap in a row", () => {
    const items = [inst("a", { x: 0, y: 0, w: 6, h: 2 })];
    expect(findFreeSpot(items, 6, 2)).toEqual({ x: 6, y: 0, w: 6, h: 2 });
  });
  it("falls to the next row when full", () => {
    const items = [inst("a", { x: 0, y: 0, w: 12, h: 2 })];
    expect(findFreeSpot(items, 4, 2)).toEqual({ x: 0, y: 2, w: 4, h: 2 });
  });
  it("caps requested width at column count", () => {
    expect(findFreeSpot([], 99, 1).w).toBe(COLS);
  });
});

describe("contentHeight", () => {
  it("returns bottom-most edge", () => {
    expect(
      contentHeight([
        inst("a", { x: 0, y: 0, w: 2, h: 2 }),
        inst("b", { x: 3, y: 4, w: 2, h: 3 }),
      ]),
    ).toBe(7);
  });
});
