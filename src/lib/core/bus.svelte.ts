/**
 * Typed event bus — the only way modules talk to each other.
 * Modules never import other modules; they emit and subscribe here.
 * Every event also lands in `busLog` (reactive), which the debug module renders.
 */

import type { Paper } from "$lib/sources/types";

export interface BusEvents {
  "search:query": { query: string };
  /** The merged, filtered result list a Paper Search module is currently showing. */
  "search:results": { query: string; papers: Paper[] };
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
const lastPayloads = new Map<BusEventName, unknown>();

/** Events whose payload is too big to keep in the debug log verbatim. */
const LOG_SUMMARY: { [K in BusEventName]?: (payload: BusEvents[K]) => unknown } = {
  "search:results": (p) => ({ query: p.query, count: p.papers.length }),
};

export const busLog: BusLogEntry[] = $state([]);
let seq = 0;

export function emit<K extends BusEventName>(name: K, payload: BusEvents[K]): void {
  lastPayloads.set(name, payload);
  const summarize = LOG_SUMMARY[name] as ((p: BusEvents[K]) => unknown) | undefined;
  busLog.push({
    seq: ++seq,
    time: new Date().toLocaleTimeString(),
    name,
    payload: summarize ? summarize(payload) : payload,
  });
  if (busLog.length > LOG_LIMIT) busLog.shift();
  handlers.get(name)?.forEach((handler) => handler(payload));
}

/**
 * The most recent payload of an event, if any was emitted this session. Lets a
 * module that is added to the board late (e.g. a Reader dropped in after a
 * paper was already selected) catch up instead of waiting for the next event.
 */
export function latest<K extends BusEventName>(name: K): BusEvents[K] | undefined {
  return lastPayloads.get(name) as BusEvents[K] | undefined;
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
