import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the JSON store.
const disk = new Map<string, unknown>();
vi.mock("./storage", () => ({
  loadJson: async (file: string, key: string) => disk.get(`${file}:${key}`) ?? null,
  saveJson: async (file: string, key: string, value: unknown) => {
    disk.set(`${file}:${key}`, structuredClone(value));
  },
  loadLegacyWorkspace: async () => disk.get("legacy") ?? null,
}));

import { registerModule } from "./registry";
import { WorkspaceState } from "./workspace.svelte";

const stub = { component: {} as never, icon: "", description: "" };
registerModule({ ...stub, id: "search", name: "Search", defaultSize: { w: 4, h: 4 }, multiInstance: true, secretSettings: ["apiKey"] });
registerModule({ ...stub, id: "reader", name: "Reader", defaultSize: { w: 4, h: 4 } });
registerModule({ ...stub, id: "notes", name: "Notes", defaultSize: { w: 4, h: 4 }, multiInstance: true });

async function fresh(): Promise<WorkspaceState> {
  const ws = new WorkspaceState();
  await ws.load();
  return ws;
}

beforeEach(() => disk.clear());

describe("first run and migration", () => {
  it("starts a brand-new install on the Research starter", async () => {
    const ws = await fresh();
    expect(ws.layouts).toHaveLength(1);
    expect(ws.name).toBe("Research");
    expect(ws.instances.map((i) => i.moduleId).sort()).toEqual(["notes", "reader", "search"]);
    expect(disk.has("layouts.json:layouts")).toBe(true);
  });

  it("migrates a v0.1 workspace, keeping its content, and leaves the old record alone", async () => {
    const legacy = {
      name: "Old board",
      instances: [
        { instanceId: "n1", moduleId: "notes", position: { x: 0, y: 0, w: 4, h: 4 }, settings: { text: "mine" } },
      ],
    };
    disk.set("legacy", legacy);
    const ws = await fresh();
    expect(ws.name).toBe("Old board");
    expect(ws.instances[0]).toMatchObject({ instanceId: "n1", settings: { text: "mine" } });
    expect(disk.get("legacy")).toEqual(legacy);
  });

  it("backs up an unreadable layouts file instead of silently overwriting it", async () => {
    const future = { version: 3, whatever: true };
    disk.set("layouts.json:layouts", future);
    const ws = await fresh();
    expect(ws.layouts).toHaveLength(1);
    expect(disk.get("layouts.json:layouts.backup")).toEqual(future);
  });
});

describe("layouts", () => {
  it("creates from a preset, switches, and keeps each board's content separate", async () => {
    const ws = await fresh();
    const researchId = ws.activeId;
    const notes = ws.instances.find((i) => i.moduleId === "notes");
    ws.updateSettings(notes!.instanceId, { text: "research notes" });

    const blankId = ws.createLayout("Scratch");
    expect(ws.activeId).toBe(blankId);
    expect(ws.instances).toEqual([]);
    ws.add("notes");
    ws.updateSettings(ws.instances[0].instanceId, { text: "scratch notes" });

    ws.switchTo(researchId);
    expect(ws.instances.find((i) => i.moduleId === "notes")?.settings.text).toBe("research notes");
    ws.switchTo(blankId);
    expect(ws.instances[0].settings.text).toBe("scratch notes");
  });

  it("persists the active layout and survives a reload", async () => {
    const ws = await fresh();
    ws.createLayout("Second", "reading");
    const reloaded = await fresh();
    expect(reloaded.layouts.map((l) => l.name)).toEqual(["Research", "Second"]);
    expect(reloaded.name).toBe("Second");
    // "Deep reading" is reader + notes + pomodoro; this test registry has no pomodoro.
    expect(reloaded.instances.map((i) => i.moduleId).sort()).toEqual(["notes", "reader"]);
  });

  it("de-duplicates names", async () => {
    const ws = await fresh();
    ws.createLayout("Research");
    ws.createLayout("research");
    expect(ws.layouts.map((l) => l.name)).toEqual(["Research", "Research (2)", "research (3)"]);
  });

  it("saveCurrentAs copies the board with fresh ids and switches to the copy", async () => {
    const ws = await fresh();
    const originalIds = ws.instances.map((i) => i.instanceId);
    const copyId = ws.saveCurrentAs("Snapshot");
    expect(ws.activeId).toBe(copyId);
    expect(ws.instances).toHaveLength(originalIds.length);
    expect(ws.instances.some((i) => originalIds.includes(i.instanceId))).toBe(false);
  });

  it("duplicate does not switch layouts", async () => {
    const ws = await fresh();
    const before = ws.activeId;
    const copy = ws.duplicate(before);
    expect(copy).not.toBeNull();
    expect(ws.activeId).toBe(before);
    expect(ws.layouts).toHaveLength(2);
  });

  it("renames, and refuses to leave a layout nameless", async () => {
    const ws = await fresh();
    ws.rename(ws.activeId, "  Renamed  ");
    expect(ws.name).toBe("Renamed");
    ws.rename(ws.activeId, "   ");
    expect(ws.name).toBe("Renamed");
  });

  it("deletes layouts, moves off a deleted active one, and keeps the last", async () => {
    const ws = await fresh();
    const first = ws.activeId;
    const second = ws.createLayout("Two");
    expect(ws.removeLayout(second)).toBe(true);
    expect(ws.activeId).toBe(first);
    expect(ws.removeLayout(first)).toBe(false);
    expect(ws.layouts).toHaveLength(1);
  });

  it("drops saved instances of modules that are no longer registered", async () => {
    const ws = await fresh();
    disk.set("layouts.json:layouts", {
      version: 2,
      activeId: "a",
      layouts: [
        {
          id: "a",
          name: "A",
          updatedAt: 1,
          instances: [
            { instanceId: "x", moduleId: "ghost", position: { x: 0, y: 0, w: 2, h: 2 }, settings: {} },
            { instanceId: "y", moduleId: "notes", position: { x: 0, y: 0, w: 2, h: 2 }, settings: {} },
          ],
        },
      ],
    });
    const again = await fresh();
    expect(again.instances.map((i) => i.moduleId)).toEqual(["notes"]);
    expect(ws.layouts.length).toBeGreaterThan(0);
  });
});

describe("export / import", () => {
  it("exports without secrets and imports as a separate layout", async () => {
    const ws = await fresh();
    const search = ws.instances.find((i) => i.moduleId === "search");
    ws.updateSettings(search!.instanceId, { query: "graphs", apiKey: "TOP-SECRET" });

    const { fileName, json } = ws.exportActive(true);
    expect(fileName).toBe("research.fieldnotes-layout.json");
    expect(json).not.toContain("TOP-SECRET");
    expect(json).toContain("graphs");

    const { parseLayoutImport } = await import("./layouts");
    const parsed = parseLayoutImport(json, (id) => (id === "ghost" ? undefined : { multiInstance: true }));
    const id = ws.addImported(parsed);
    expect(ws.activeId).toBe(id);
    expect(ws.name).toBe("Research (2)");
    expect(ws.layouts).toHaveLength(2);
  });

  it("exports an empty-content version on request", async () => {
    const ws = await fresh();
    const search = ws.instances.find((i) => i.moduleId === "search");
    ws.updateSettings(search!.instanceId, { query: "graphs" });
    expect(ws.exportActive(false).json).not.toContain("graphs");
  });
});
