/**
 * Typed event bus — the only way modules talk to each other.
 * Modules never import other modules; they emit and subscribe here.
 * Every event also lands in `busLog` (reactive), which the debug module renders.
 */

import type { Paper } from "$lib/sources/types";

export interface BusEvents {
  "search:query": { query: string };
  "paper:selected": { paper: Paper };
  "pomodoro:phase": { phase: "work" | "break" };
}

export type BusEventName = keyof BusEvents;

export interface BusLogEntry {
  seq: number;
  time: string;
  name: BusEventName;
  payload: unknown;
}

const LOG_LIMIT = 50;

const handlers = new Map<BusEventName, Set<(payload: unknown) => void>>();

export const busLog: BusLogEntry[] = $state([]);
let seq = 0;

export function emit<K extends BusEventName>(name: K, payload: BusEvents[K]): void {
  busLog.push({
    seq: ++seq,
    time: new Date().toLocaleTimeString(),
    name,
    payload,
  });
  if (busLog.length > LOG_LIMIT) busLog.shift();
  handlers.get(name)?.forEach((handler) => handler(payload));
}

/** Subscribe to an event. Returns an unsubscribe function — call it on teardown. */
export function on<K extends BusEventName>(
  name: K,
  handler: (payload: BusEvents[K]) => void,
): () => void {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  const erased = handler as (payload: unknown) => void;
  set.add(erased);
  return () => set?.delete(erased);
}
