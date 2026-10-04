/**
 * Network plumbing shared by every module.
 *
 * Inside Tauri, requests go through the Rust-side HTTP plugin: no CORS, and
 * the allowed hosts are pinned in `src-tauri/capabilities/default.json`. In a
 * plain browser (`npm run dev`) they fall back to `window.fetch`, which only
 * works for hosts that send CORS headers.
 */

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function httpFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  if (inTauri()) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    return fetch(input, init);
  }
  return globalThis.fetch(input, init);
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const RETRYABLE = new Set([429, 502, 503, 504]);

export interface RetryOptions {
  /** Extra attempts after the first. Default 2. */
  retries?: number;
  baseDelayMs?: number;
  /** Never wait longer than this; a server asking for more is returned as-is. */
  maxDelayMs?: number;
  /** Injection points for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  fetch?: FetchLike;
}

/** Seconds ("3") or an HTTP date, as a delay in ms; null when absent or unparsable. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * fetch with a small, bounded retry for rate limits and transient gateway
 * errors. Honours `Retry-After`; gives up (returning the failing response so
 * the caller can report it) when the server wants a longer wait than
 * `maxDelayMs`.
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const {
    retries = 2,
    baseDelayMs = 800,
    maxDelayMs = 6000,
    sleep = abortableSleep,
    fetch: doFetch = httpFetch,
  } = opts;

  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(input, init);
    if (!RETRYABLE.has(res.status) || attempt >= retries) return res;

    const requested = parseRetryAfter(res.headers.get("retry-after"));
    const wait = requested ?? baseDelayMs * 2 ** attempt;
    if (wait > maxDelayMs) return res;

    try {
      await res.body?.cancel();
    } catch {
      // Releasing the body is best effort.
    }
    await sleep(wait, init.signal ?? undefined);
  }
}

/** Binary downloads (PDFs). Publishers rarely send CORS headers, hence httpFetch. */
export async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await httpFetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Open a web link in the system browser (or a new tab outside Tauri). http(s)/mailto only. */
export async function openExternal(url: string): Promise<void> {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (inTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
