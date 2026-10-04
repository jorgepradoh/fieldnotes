import { describe, expect, it, vi } from "vitest";
import { abortableSleep, fetchWithRetry, isAbortError, openExternal, parseRetryAfter } from "./net";

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response("body", { status, headers });
}

/** A fetch that serves the given responses in order. */
function sequence(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("fetch called more times than expected");
    return next;
  });
}

describe("parseRetryAfter", () => {
  it("reads seconds", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("reads an HTTP date relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:05 GMT", now)).toBe(5000);
    expect(parseRetryAfter("Wed, 31 Dec 2025 23:59:00 GMT", now)).toBe(0);
  });

  it("returns null for absent or junk values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

describe("fetchWithRetry", () => {
  const noSleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => undefined);

  it("returns a good response without sleeping", async () => {
    noSleep.mockClear();
    const fetch = sequence(res(200));
    expect((await fetchWithRetry("https://x", {}, { fetch, sleep: noSleep })).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("retries transient failures with exponential backoff", async () => {
    const sleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => undefined);
    const fetch = sequence(res(503), res(429), res(200));
    const out = await fetchWithRetry("https://x", {}, { fetch, sleep, baseDelayMs: 100 });
    expect(out.status).toBe(200);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it("returns the failing response after the retries are spent", async () => {
    const fetch = sequence(res(429), res(429), res(429));
    const out = await fetchWithRetry("https://x", {}, { fetch, sleep: noSleep, retries: 2 });
    expect(out.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors", async () => {
    const fetch = sequence(res(404));
    expect((await fetchWithRetry("https://x", {}, { fetch, sleep: noSleep })).status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("honours a short Retry-After", async () => {
    const sleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => undefined);
    const fetch = sequence(res(429, { "retry-after": "2" }), res(200));
    await fetchWithRetry("https://x", {}, { fetch, sleep });
    expect(sleep.mock.calls[0][0]).toBe(2000);
  });

  it("gives up immediately when the server wants longer than the cap", async () => {
    const sleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => undefined);
    const fetch = sequence(res(429, { "retry-after": "120" }));
    const out = await fetchWithRetry("https://x", {}, { fetch, sleep, maxDelayMs: 6000 });
    expect(out.status).toBe(429);
    expect(sleep).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes the abort signal to sleep so a cancelled search stops waiting", async () => {
    const controller = new AbortController();
    const sleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => undefined);
    const fetch = sequence(res(503), res(200));
    await fetchWithRetry("https://x", { signal: controller.signal }, { fetch, sleep });
    expect(sleep.mock.calls[0][1]).toBe(controller.signal);
  });
});

describe("abortableSleep", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    const done = vi.fn();
    void abortableSleep(1000).then(done);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("rejects with an AbortError when aborted mid-sleep", async () => {
    const controller = new AbortController();
    const pending = abortableSleep(60_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toSatisfy(isAbortError);
  });

  it("rejects immediately if already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(10, controller.signal)).rejects.toSatisfy(isAbortError);
  });
});

describe("openExternal", () => {
  it("refuses non-web schemes", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    await openExternal("javascript:alert(1)");
    await openExternal("file:///etc/passwd");
    expect(open).not.toHaveBeenCalled();
    await openExternal("https://example.org");
    expect(open).toHaveBeenCalledWith("https://example.org", "_blank", "noopener,noreferrer");
    vi.unstubAllGlobals();
  });
});
