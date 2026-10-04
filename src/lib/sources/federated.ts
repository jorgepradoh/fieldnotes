/**
 * Searching several sources at once. Each source keeps its own paging state
 * (`SourceBatch`); a failing source never takes the others down; the visible
 * list is always derived from the batches (fuse → filter → sort), so changing
 * the sort or a filter re-derives instantly with no network.
 */
import { isAbortError } from "../core/net";
import { applyFilters, fuseRankings, sortPapers } from "./merge";
import type { Paper, PaperSource, SearchFilters, SearchOptions, SortMode } from "./types";

export interface SourceBatch {
  /** Everything fetched from this source for the current query, in its own rank order. */
  papers: Paper[];
  total: number;
  /** Offset to request next, or null once exhausted. */
  next: number | null;
  /** Set when the last fetch for this source failed; `next` then points at the retry. */
  error: string | null;
}

export type Batches = Record<string, SourceBatch>;

export interface SourceConfig {
  source: PaperSource;
  opts: SearchOptions;
}

export interface FederatedRequest {
  query: string;
  limit: number;
  filters?: SearchFilters;
  sort?: SortMode;
  signal?: AbortSignal;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fetch one page from every source that still has one (and retry sources that
 * failed). Pass `prev` to continue a search; omit it to start over. Resolves
 * with a complete new `Batches`; rejects only if the request was aborted.
 */
export async function fetchNextPage(
  configs: SourceConfig[],
  req: FederatedRequest,
  prev: Batches | null,
): Promise<Batches> {
  const entries = await Promise.all(
    configs.map(async ({ source, opts }): Promise<[string, SourceBatch]> => {
      const before = prev?.[source.id];
      if (before && before.next === null && !before.error) return [source.id, before];

      const offset = before?.next ?? 0;
      try {
        const result = await source.search(
          { query: req.query, limit: req.limit, offset, filters: req.filters, sort: req.sort },
          { ...opts, signal: req.signal },
        );
        return [
          source.id,
          {
            papers: offset === 0 ? result.papers : [...(before?.papers ?? []), ...result.papers],
            total: result.total,
            next: result.nextOffset,
            error: null,
          },
        ];
      } catch (err) {
        if (isAbortError(err)) throw err;
        return [
          source.id,
          {
            papers: before?.papers ?? [],
            total: before?.total ?? 0,
            next: offset,
            error: messageOf(err),
          },
        ];
      }
    }),
  );
  return Object.fromEntries(entries);
}

/** The list the user sees. `order` is the source preference order. */
export function visiblePapers(
  batches: Batches,
  order: string[],
  filters: SearchFilters | undefined,
  sort: SortMode,
): Paper[] {
  const lists = order.map((id) => batches[id]?.papers ?? []);
  return sortPapers(applyFilters(fuseRankings(lists), filters), sort);
}

export function hasMore(batches: Batches): boolean {
  return Object.values(batches).some((b) => b.next !== null);
}

export function failures(batches: Batches): { id: string; message: string }[] {
  return Object.entries(batches)
    .filter(([, b]) => b.error)
    .map(([id, b]) => ({ id, message: b.error ?? "" }));
}

export function allFailed(batches: Batches): boolean {
  const all = Object.values(batches);
  return all.length > 0 && all.every((b) => b.error !== null);
}
