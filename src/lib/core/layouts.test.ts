import { describe, expect, it } from "vitest";
import { collides } from "./grid";
import {
  LAYOUT_FORMAT,
  LayoutImportError,
  MAX_INSTANCES,
  cleanName,
  describeDropped,
  exportLayout,
  layoutFileName,
  migrateLegacy,
  normalizeLayoutsFile,
  parseLayoutImport,
  resolveOverlaps,
  sanitizeInstances,
  stripSecrets,
  uniqueName,
  type ModuleLookup,
} from "./layouts";
import { PRESETS, instantiatePreset } from "./presets";
import type { ModuleInstance } from "./types";

const defs: Record<string, ReturnType<ModuleLookup>> = {
  search: { minSize: { w: 2, h: 2 }, multiInstance: true, secretSettings: ["apiKey", "email"] },
  reader: { minSize: { w: 3, h: 3 }, multiInstance: false },
  notes: { multiInstance: true },
};
const lookup: ModuleLookup = (id) => defs[id];

let counter = 0;
const mint = (): string => `id-${++counter}`;

function inst(moduleId: string, x: number, y: number, w: number, h: number, settings = {}) {
  return { instanceId: mint(), moduleId, position: { x, y, w, h }, settings } satisfies ModuleInstance;
}

function noOverlaps(items: ModuleInstance[]): boolean {
  return items.every((a, i) => items.slice(i + 1).every((b) => !collides(a.position, b.position)));
}

describe("names", () => {
  it("cleans whitespace, length and empties", () => {
    expect(cleanName("  my   board \n", "x")).toBe("my board");
    expect(cleanName("   ", "fallback")).toBe("fallback");
    expect(cleanName("a".repeat(200), "x")).toHaveLength(60);
  });

  it("makes names unique case-insensitively", () => {
    expect(uniqueName("Reading", ["Notes"])).toBe("Reading");
    expect(uniqueName("Reading", ["reading"])).toBe("Reading (2)");
    expect(uniqueName("Reading", ["Reading", "Reading (2)"])).toBe("Reading (3)");
  });

  it("keeps the suffix within the length limit", () => {
    const long = "a".repeat(60);
    const result = uniqueName(long, [long]);
    expect(result).toHaveLength(60);
    expect(result.endsWith(" (2)")).toBe(true);
  });

  it("builds a safe file name", () => {
    expect(layoutFileName("My Reading / Layout!")).toBe("my-reading-layout.fieldnotes-layout.json");
    expect(layoutFileName("???")).toBe("layout.fieldnotes-layout.json");
  });
});

describe("resolveOverlaps", () => {
  it("separates overlapping items and compacts upward", () => {
    const out = resolveOverlaps([inst("notes", 0, 0, 6, 4), inst("notes", 2, 1, 6, 4)]);
    expect(noOverlaps(out)).toBe(true);
    expect(out[1].position.y).toBe(4);
  });

  it("leaves a valid layout alone", () => {
    const items = [inst("notes", 0, 0, 6, 4), inst("notes", 6, 0, 6, 4)];
    expect(resolveOverlaps(items).map((i) => i.position)).toEqual(items.map((i) => i.position));
  });
});

describe("sanitizeInstances", () => {
  it("rejects non-arrays", () => {
    const { instances, dropped } = sanitizeInstances({}, lookup, mint);
    expect(instances).toEqual([]);
    expect(dropped.invalid).toBe(1);
  });

  it("drops unknown modules, malformed entries and duplicate singletons", () => {
    const { instances, dropped } = sanitizeInstances(
      [
        { moduleId: "ghost", position: { x: 0, y: 0, w: 2, h: 2 } },
        { moduleId: "reader", position: { x: 0, y: 0, w: 4, h: 4 } },
        { moduleId: "reader", position: { x: 4, y: 0, w: 4, h: 4 } },
        { moduleId: "notes", position: { x: "a", y: 0, w: 2, h: 2 } },
        "nonsense",
        { position: {} },
      ],
      lookup,
      mint,
    );
    expect(instances.map((i) => i.moduleId)).toEqual(["reader"]);
    expect(dropped).toEqual({ unknownModule: 1, duplicateSingleton: 1, invalid: 3, overflow: 0 });
  });

  it("clamps to bounds and module minimum size, rounds floats", () => {
    const { instances } = sanitizeInstances(
      [{ moduleId: "reader", position: { x: 40.4, y: -3, w: 1, h: 1.6 } }],
      lookup,
      mint,
    );
    expect(instances[0].position).toEqual({ x: 9, y: 0, w: 3, h: 3 });
  });

  it("caps the number of modules", () => {
    const raw = Array.from({ length: MAX_INSTANCES + 5 }, (_, i) => ({
      moduleId: "notes",
      position: { x: 0, y: i, w: 2, h: 1 },
    }));
    const { instances, dropped } = sanitizeInstances(raw, lookup, mint);
    expect(instances).toHaveLength(MAX_INSTANCES);
    expect(dropped.overflow).toBe(5);
  });

  it("mints fresh ids by default and keeps stored ids when asked", () => {
    const raw = [{ instanceId: "keep-me", moduleId: "notes", position: { x: 0, y: 0, w: 2, h: 2 } }];
    expect(sanitizeInstances(raw, lookup, mint).instances[0].instanceId).not.toBe("keep-me");
    expect(sanitizeInstances(raw, lookup, mint, true).instances[0].instanceId).toBe("keep-me");
  });

  it("never reuses a stored id twice", () => {
    const raw = [
      { instanceId: "dup", moduleId: "notes", position: { x: 0, y: 0, w: 2, h: 2 } },
      { instanceId: "dup", moduleId: "notes", position: { x: 2, y: 0, w: 2, h: 2 } },
    ];
    const ids = sanitizeInstances(raw, lookup, mint, true).instances.map((i) => i.instanceId);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("export", () => {
  const layout = {
    name: "Reading",
    instances: [
      inst("search", 0, 0, 4, 4, { query: "diffusion", apiKey: "SECRET", email: "me@x.io" }),
      inst("notes", 4, 0, 4, 4, { text: "# hi" }),
    ],
  };

  it("strips secret keys but keeps other settings", () => {
    const out = exportLayout(layout, lookup, { includeContent: true });
    expect(out.format).toBe(LAYOUT_FORMAT);
    expect(out.modules[0].settings).toEqual({ query: "diffusion" });
    expect(out.modules[1].settings).toEqual({ text: "# hi" });
    expect(JSON.stringify(out)).not.toContain("SECRET");
    expect(JSON.stringify(out)).not.toContain("me@x.io");
  });

  it("drops all settings when content is excluded", () => {
    const out = exportLayout(layout, lookup, { includeContent: false });
    expect(out.includesContent).toBe(false);
    expect(out.modules.map((m) => m.settings)).toEqual([{}, {}]);
  });

  it("does not export instance ids", () => {
    const out = exportLayout(layout, lookup, { includeContent: true });
    expect(JSON.stringify(out)).not.toContain("instanceId");
  });

  it("stripSecrets leaves unknown modules untouched", () => {
    expect(stripSecrets("ghost", { a: 1 }, lookup)).toEqual({ a: 1 });
  });
});

describe("import", () => {
  function file(extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      format: LAYOUT_FORMAT,
      version: 1,
      name: "Shared",
      modules: [
        { moduleId: "search", position: { x: 0, y: 0, w: 4, h: 4 }, settings: { query: "q", apiKey: "LEAK" } },
        { moduleId: "ghost", position: { x: 4, y: 0, w: 4, h: 4 }, settings: {} },
      ],
      ...extra,
    });
  }

  it("round-trips an export", () => {
    const original = {
      name: "Round trip",
      instances: [inst("search", 0, 0, 4, 4, { query: "x" }), inst("notes", 4, 0, 4, 4, { text: "t" })],
    };
    const text = JSON.stringify(exportLayout(original, lookup, { includeContent: true }));
    const parsed = parseLayoutImport(text, lookup, mint);
    expect(parsed.name).toBe("Round trip");
    expect(parsed.instances.map((i) => [i.moduleId, i.position, i.settings])).toEqual(
      original.instances.map((i) => [i.moduleId, i.position, i.settings]),
    );
    expect(parsed.instances.map((i) => i.instanceId)).not.toContain(original.instances[0].instanceId);
  });

  it("strips secrets even if the file contains them", () => {
    const parsed = parseLayoutImport(file(), lookup, mint);
    expect(parsed.instances[0].settings).toEqual({ query: "q" });
  });

  it("reports dropped modules", () => {
    const parsed = parseLayoutImport(file(), lookup, mint);
    expect(parsed.instances).toHaveLength(1);
    expect(parsed.dropped.unknownModule).toBe(1);
    expect(describeDropped(parsed.dropped)).toContain("1 from modules this version doesn't have");
    expect(describeDropped(parsed.dropped)).toMatch(/^Skipped/);
  });

  it("falls back to a default name", () => {
    expect(parseLayoutImport(file({ name: 42 }), lookup, mint).name).toBe("Imported layout");
  });

  it("rejects non-JSON, foreign JSON and newer versions with friendly errors", () => {
    expect(() => parseLayoutImport("nope", lookup)).toThrow(LayoutImportError);
    expect(() => parseLayoutImport("{}", lookup)).toThrow(/not a fieldnotes layout/);
    expect(() => parseLayoutImport(file({ version: 99 }), lookup)).toThrow(/newer version/);
    expect(() => parseLayoutImport("x".repeat(6_000_000), lookup)).toThrow(/too large/);
  });

  it("resolves overlapping rects from a hand-edited file", () => {
    const text = file({
      modules: [
        { moduleId: "notes", position: { x: 0, y: 0, w: 6, h: 4 }, settings: {} },
        { moduleId: "notes", position: { x: 0, y: 0, w: 6, h: 4 }, settings: {} },
      ],
    });
    expect(noOverlaps(parseLayoutImport(text, lookup, mint).instances)).toBe(true);
  });

  it("ignores __proto__ keys in settings", () => {
    const text =
      '{"format":"fieldnotes-layout","version":1,"name":"x","modules":[{"moduleId":"notes",' +
      '"position":{"x":0,"y":0,"w":4,"h":4},"settings":{"text":"ok","__proto__":{"polluted":true}}}]}';
    expect(text).toContain("__proto__");
    // Sanity: a bare JSON.parse would keep the key as an own property.
    expect(Object.keys(JSON.parse(text).modules[0].settings)).toContain("__proto__");

    const parsed = parseLayoutImport(text, lookup, mint);
    expect(Object.keys(parsed.instances[0].settings)).toEqual(["text"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("stored file", () => {
  const good = {
    version: 2,
    activeId: "b",
    layouts: [
      { id: "a", name: "One", updatedAt: 1, instances: [{ instanceId: "i1", moduleId: "notes", position: { x: 0, y: 0, w: 4, h: 4 }, settings: { text: "keep" } }] },
      { id: "b", name: "one", updatedAt: 2, instances: [] },
    ],
  };

  it("keeps ids, settings and the active layout, and de-duplicates names", () => {
    const file = normalizeLayoutsFile(good, lookup);
    expect(file?.activeId).toBe("b");
    expect(file?.layouts[0].instances[0]).toMatchObject({ instanceId: "i1", settings: { text: "keep" } });
    expect(file?.layouts.map((l) => l.name)).toEqual(["One", "one (2)"]);
  });

  it("falls back to the first layout when activeId is stale", () => {
    expect(normalizeLayoutsFile({ ...good, activeId: "zzz" }, lookup)?.activeId).toBe("a");
  });

  it("returns null for garbage so the app can start fresh", () => {
    expect(normalizeLayoutsFile(null, lookup)).toBeNull();
    expect(normalizeLayoutsFile({ version: 1 }, lookup)).toBeNull();
    expect(normalizeLayoutsFile({ version: 2, layouts: [] }, lookup)).toBeNull();
    expect(normalizeLayoutsFile({ version: 2, layouts: [{ nope: 1 }] }, lookup)).toBeNull();
  });

  it("drops instances of modules that no longer exist", () => {
    const file = normalizeLayoutsFile(
      { version: 2, activeId: "a", layouts: [{ id: "a", name: "x", instances: [{ instanceId: "g", moduleId: "ghost", position: { x: 0, y: 0, w: 2, h: 2 }, settings: {} }] }] },
      lookup,
    );
    expect(file?.layouts[0].instances).toEqual([]);
  });
});

describe("migrateLegacy", () => {
  it("wraps the v0.1 workspace as the only, active layout", () => {
    const legacy = {
      name: "My workspace",
      instances: [inst("notes", 0, 0, 4, 4, { text: "old note" })],
    };
    const file = migrateLegacy(legacy, lookup);
    expect(file?.layouts).toHaveLength(1);
    expect(file?.activeId).toBe(file?.layouts[0].id);
    expect(file?.layouts[0].name).toBe("My workspace");
    expect(file?.layouts[0].instances[0]).toMatchObject({ instanceId: legacy.instances[0].instanceId, settings: { text: "old note" } });
  });

  it("returns null when there is nothing to migrate", () => {
    expect(migrateLegacy(null, lookup)).toBeNull();
  });
});

describe("presets", () => {
  const all: ModuleLookup = () => ({ multiInstance: true });

  it("are valid boards when every module exists", () => {
    for (const preset of PRESETS) {
      const items = instantiatePreset(preset, all, mint);
      expect(noOverlaps(items), preset.id).toBe(true);
      for (const it of items) {
        expect(it.position.x + it.position.w, preset.id).toBeLessThanOrEqual(12);
        expect(it.position.x, preset.id).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("skip modules the build does not have", () => {
    const onlyNotes: ModuleLookup = (id) => (id === "notes" ? { multiInstance: true } : undefined);
    const research = PRESETS.find((p) => p.id === "research");
    expect(research).toBeDefined();
    expect(instantiatePreset(research!, onlyNotes, mint).map((i) => i.moduleId)).toEqual(["notes"]);
  });

  it("have unique ids", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
});
