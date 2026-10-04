/**
 * Pure layout logic: validating what comes off disk or out of an imported
 * file, exporting without leaking secrets, naming, and migrating the old
 * single-workspace format. No DOM, no runes — unit-tested in layouts.test.ts.
 */
import { clampRect, collides, packUp } from "./grid";
import type {
  GridRect,
  Layout,
  LayoutsFile,
  LegacyWorkspace,
  ModuleDefinition,
  ModuleInstance,
} from "./types";

export const LAYOUT_FORMAT = "fieldnotes-layout";
export const LAYOUT_VERSION = 1;
export const MAX_IMPORT_CHARS = 5_000_000;
/** Byte limit checked on the file itself, before its text is read (UTF-8 can be up to 4 bytes per char). */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_INSTANCES = 60;
export const MAX_NAME_LENGTH = 60;
/**
 * Rows a module may start at, and its maximum height. Without bounds a layout
 * file with `y: 1000000000` would make the packing loop walk a billion rows
 * (a freeze) and size the board to match.
 */
export const MAX_ROW = 500;
export const MAX_MODULE_ROWS = 200;

/** The slice of a module definition layout code needs; keeps this file registry-free. */
export type ModuleLookup = (
  moduleId: string,
) => Pick<ModuleDefinition, "minSize" | "multiInstance" | "secretSettings"> | undefined;

export class LayoutImportError extends Error {}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

// ---------------------------------------------------------------- naming

export function cleanName(name: string, fallback: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || fallback;
}

/** "Reading" → "Reading (2)" → "Reading (3)" … compared case-insensitively. */
export function uniqueName(desired: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(desired.toLowerCase())) return desired;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = desired.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

// ------------------------------------------------------------- validation

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRect(value: unknown): GridRect | null {
  if (!isRecord(value)) return null;
  const { x, y, w, h } = value;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return {
    x: Math.round(x as number),
    y: Math.round(y as number),
    w: Math.round(w as number),
    h: Math.round(h as number),
  };
}

/** Parse JSON, discarding `__proto__` keys so nothing can poison object prototypes later. */
function safeParse(text: string): unknown {
  return JSON.parse(text, (key, value) => (key === "__proto__" ? undefined : value));
}

/** Move overlapping items down until nothing collides, then compact upwards. */
export function resolveOverlaps(items: ModuleInstance[]): ModuleInstance[] {
  const result = items.map((it) => ({ ...it, position: { ...it.position } }));
  const order = [...result].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const placed: GridRect[] = [];
  for (const item of order) {
    let rect = item.position;
    for (;;) {
      const hit = placed.find((p) => collides(rect, p));
      if (!hit) break;
      rect = { ...rect, y: hit.y + hit.h };
    }
    item.position = rect;
    placed.push(rect);
  }
  return packUp(result);
}

export interface DropCounts {
  unknownModule: number;
  duplicateSingleton: number;
  invalid: number;
  overflow: number;
}

export function emptyDropCounts(): DropCounts {
  return { unknownModule: 0, duplicateSingleton: 0, invalid: 0, overflow: 0 };
}

export function totalDropped(d: DropCounts): number {
  return d.unknownModule + d.duplicateSingleton + d.invalid + d.overflow;
}

/**
 * Turn untrusted `[{moduleId, position, settings}]` into placed, collision-free
 * instances with fresh ids. Anything unusable is dropped and counted.
 */
export function sanitizeInstances(
  raw: unknown,
  lookup: ModuleLookup,
  makeId: () => string = newId,
  /** Keep stored `instanceId`s (our own files) instead of minting new ones (imports). */
  keepIds = false,
): { instances: ModuleInstance[]; dropped: DropCounts } {
  const dropped = emptyDropCounts();
  const out: ModuleInstance[] = [];
  const seenSingletons = new Set<string>();
  const usedIds = new Set<string>();

  if (!Array.isArray(raw)) {
    dropped.invalid += 1;
    return { instances: [], dropped };
  }

  for (const entry of raw) {
    if (out.length >= MAX_INSTANCES) {
      dropped.overflow += 1;
      continue;
    }
    if (!isRecord(entry) || typeof entry.moduleId !== "string") {
      dropped.invalid += 1;
      continue;
    }
    const def = lookup(entry.moduleId);
    if (!def) {
      dropped.unknownModule += 1;
      continue;
    }
    if (!def.multiInstance) {
      if (seenSingletons.has(entry.moduleId)) {
        dropped.duplicateSingleton += 1;
        continue;
      }
      seenSingletons.add(entry.moduleId);
    }
    const rect = toRect(entry.position);
    if (!rect) {
      dropped.invalid += 1;
      continue;
    }
    const stored = typeof entry.instanceId === "string" ? entry.instanceId : "";
    const instanceId = keepIds && stored && !usedIds.has(stored) ? stored : makeId();
    usedIds.add(instanceId);
    const fitted = clampRect(rect, def.minSize?.w ?? 1, def.minSize?.h ?? 1);
    out.push({
      instanceId,
      moduleId: entry.moduleId,
      position: { ...fitted, y: Math.min(fitted.y, MAX_ROW), h: Math.min(fitted.h, MAX_MODULE_ROWS) },
      settings: isRecord(entry.settings) ? (entry.settings as Record<string, unknown>) : {},
    });
  }
  return { instances: resolveOverlaps(out), dropped };
}

// ----------------------------------------------------------------- export

export function stripSecrets(
  moduleId: string,
  settings: Record<string, unknown>,
  lookup: ModuleLookup,
): Record<string, unknown> {
  const secret = new Set(lookup(moduleId)?.secretSettings ?? []);
  if (secret.size === 0) return { ...settings };
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !secret.has(key)));
}

export interface ExportedLayout {
  format: typeof LAYOUT_FORMAT;
  version: typeof LAYOUT_VERSION;
  name: string;
  exportedAt: string;
  /** false when module settings (notes text, queries…) were left out. */
  includesContent: boolean;
  modules: { moduleId: string; position: GridRect; settings: Record<string, unknown> }[];
}

export function exportLayout(
  layout: { name: string; instances: ModuleInstance[] },
  lookup: ModuleLookup,
  opts: { includeContent: boolean },
  now: Date = new Date(),
): ExportedLayout {
  return {
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    name: layout.name,
    exportedAt: now.toISOString(),
    includesContent: opts.includeContent,
    modules: layout.instances.map((it) => ({
      moduleId: it.moduleId,
      position: { ...it.position },
      // Secrets are stripped either way; "content" is everything else.
      settings: opts.includeContent ? stripSecrets(it.moduleId, it.settings, lookup) : {},
    })),
  };
}

export function layoutFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "layout"}.fieldnotes-layout.json`;
}

// ----------------------------------------------------------------- import

export interface ParsedLayoutImport {
  name: string;
  instances: ModuleInstance[];
  dropped: DropCounts;
}

export function parseLayoutImport(
  text: string,
  lookup: ModuleLookup,
  makeId: () => string = newId,
): ParsedLayoutImport {
  if (text.length > MAX_IMPORT_CHARS) {
    throw new LayoutImportError("That file is too large to be a layout.");
  }
  let data: unknown;
  try {
    data = safeParse(text);
  } catch {
    throw new LayoutImportError("That file is not valid JSON.");
  }
  if (!isRecord(data) || data.format !== LAYOUT_FORMAT) {
    throw new LayoutImportError("That file is not a fieldnotes layout.");
  }
  if (typeof data.version !== "number" || data.version > LAYOUT_VERSION) {
    throw new LayoutImportError(
      "That layout was made by a newer version of fieldnotes. Update the app to import it.",
    );
  }
  const { instances, dropped } = sanitizeInstances(data.modules, lookup, makeId);
  // An import is never allowed to smuggle in settings the exporter would have stripped.
  const cleaned = instances.map((it) => ({
    ...it,
    settings: stripSecrets(it.moduleId, it.settings, lookup),
  }));
  return {
    name: cleanName(typeof data.name === "string" ? data.name : "", "Imported layout"),
    instances: cleaned,
    dropped,
  };
}

/** One human-readable line describing what an import dropped, or "" if nothing. */
export function describeDropped(d: DropCounts): string {
  const parts: string[] = [];
  if (d.unknownModule) parts.push(`${d.unknownModule} from modules this version doesn't have`);
  if (d.duplicateSingleton) parts.push(`${d.duplicateSingleton} duplicate single-use`);
  if (d.invalid) parts.push(`${d.invalid} malformed`);
  if (d.overflow) parts.push(`${d.overflow} over the ${MAX_INSTANCES}-module limit`);
  return parts.length ? `Skipped ${parts.join(", ")}.` : "";
}

// ------------------------------------------------- stored file + migration

export function makeLayout(name: string, instances: ModuleInstance[], now = Date.now()): Layout {
  return { id: newId(), name, instances, updatedAt: now };
}

/** Validate a `layouts.json` read from disk; null means "unusable, start over". */
export function normalizeLayoutsFile(raw: unknown, lookup: ModuleLookup): LayoutsFile | null {
  if (!isRecord(raw) || raw.version !== 2 || !Array.isArray(raw.layouts)) return null;

  const layouts: Layout[] = [];
  const names: string[] = [];
  for (const entry of raw.layouts) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    if (layouts.some((l) => l.id === entry.id)) continue;
    const name = uniqueName(cleanName(String(entry.name ?? ""), "Layout"), names);
    names.push(name);
    const { instances } = sanitizeInstances(entry.instances, lookup, newId, true);
    layouts.push({
      id: entry.id,
      name,
      instances,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
    });
  }
  if (layouts.length === 0) return null;
  const activeId =
    typeof raw.activeId === "string" && layouts.some((l) => l.id === raw.activeId)
      ? raw.activeId
      : layouts[0].id;
  return { version: 2, activeId, layouts };
}

export function migrateLegacy(legacy: LegacyWorkspace | null, lookup: ModuleLookup): LayoutsFile | null {
  if (!legacy || !Array.isArray(legacy.instances)) return null;
  const { instances } = sanitizeInstances(legacy.instances, lookup, newId, true);
  const layout = makeLayout(cleanName(legacy.name ?? "", "My workspace"), instances);
  return { version: 2, activeId: layout.id, layouts: [layout] };
}
