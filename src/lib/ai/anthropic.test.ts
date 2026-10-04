import { describe, expect, it, vi } from "vitest";
import { anthropicProvider, supportsServerSideFallback } from "./anthropic";
import { LlmError, type LlmEvent, type ProviderProfile } from "./types";

const profile: ProviderProfile = {
  id: "a",
  name: "Claude",
  kind: "anthropic",
  baseUrl: "https://api.anthropic.com",
  apiKey: "sk-ant-test",
  model: "claude-opus-5-5",
  maxTokens: 4000,
};

type Ev = Record<string, unknown>;

/** Anthropic-style SSE: `event:` + `data:` per message. */
function sse(events: Ev[], opts: { chunk?: number; status?: number } = {}): Response {
  const text = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  const size = opts.chunk ?? 23;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size));
        c.close();
      },
    }),
    { status: opts.status ?? 200, headers: { "content-type": "text/event-stream" } },
  );
}

const start = (model = "claude-opus-5-5"): Ev => ({
  type: "message_start",
  message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 25, output_tokens: 1 } },
});
const textStart: Ev = { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
const textDelta = (text: string): Ev => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const stop0: Ev = { type: "content_block_stop", index: 0 };
const msgDelta = (delta: Ev, output = 15): Ev => ({ type: "message_delta", delta: { stop_sequence: null, ...delta }, usage: { output_tokens: output } });
const msgStop: Ev = { type: "message_stop" };

const happy = (): Response =>
  sse([start(), textStart, textDelta("Hello"), textDelta(", wörld"), stop0, msgDelta({ stop_reason: "end_turn" }), msgStop]);

async function collect(p: ReturnType<typeof anthropicProvider>, req = { messages: [{ role: "user" as const, content: "hi" }] }): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const e of p.stream(req)) out.push(e);
  return out;
}
const textOf = (events: LlmEvent[]): string => events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");

function provider(p: ProviderProfile, fetch: (...a: never[]) => Promise<Response>) {
  return anthropicProvider(p, { fetch: fetch as never, maxRetries: 0 });
}

describe("supportsServerSideFallback", () => {
  const base = { baseUrl: "https://api.anthropic.com" };
  it.each([
    ["claude-opus-5-5", true],
    ["claude-opus-5", true],
    ["claude-sonnet-5-5", true],
    ["claude-fable-5-1", true],
    ["claude-haiku-4-5", false],
    ["claude-opus-4-8", false],
    ["claude-opus-5-5-20260101", false],
    ["gpt-4o", false],
  ])("%s → %s", (model, expected) => {
    expect(supportsServerSideFallback({ ...base, model })).toBe(expected);
  });

  it("is off for other hosts, bad URLs and when the user turned it off", () => {
    const model = "claude-opus-5-5";
    expect(supportsServerSideFallback({ model, baseUrl: "https://my-gateway.example.com" })).toBe(false);
    expect(supportsServerSideFallback({ model, baseUrl: "nonsense" })).toBe(false);
    expect(supportsServerSideFallback({ model, baseUrl: "https://api.anthropic.com", refusalFallback: false })).toBe(false);
    expect(supportsServerSideFallback({ model, baseUrl: "" })).toBe(true);
  });
});

describe("stream", () => {
  it("streams text and reports stop reason, model and usage", async () => {
    const events = await collect(provider(profile, async () => happy()));
    expect(textOf(events)).toBe("Hello, wörld");
    expect(events.at(-1)).toMatchObject({
      type: "done",
      stopReason: "end_turn",
      model: "claude-opus-5-5",
      usage: { inputTokens: 25, outputTokens: 15 },
    });
    expect((events.at(-1) as { notice?: string }).notice).toBeUndefined();
  });

  it("sends a minimal request to the plain endpoint for models without fallback", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) => happy());
    await collect(provider({ ...profile, model: "claude-haiku-4-5" }, fetch as never), {
      system: "Be brief.",
      messages: [{ role: "user", content: "hi" }],
    } as never);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      model: "claude-haiku-4-5",
      max_tokens: 4000,
      system: "Be brief.",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("sk-ant-test");
    expect(headers.get("anthropic-version")).toBeTruthy();
    expect(headers.get("anthropic-beta")).toBeNull();
  });

  it("never sends thinking, effort or sampling parameters", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) => happy());
    await collect(provider(profile, fetch as never));
    const body = JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body));
    for (const key of ["thinking", "output_config", "temperature", "top_p", "top_k", "tool_choice"]) {
      expect(body, key).not.toHaveProperty(key);
    }
  });

  it("opts supported models into server-side fallback", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) => happy());
    await collect(provider(profile, fetch as never));
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/v1/messages");
    expect(new Headers(init.headers).get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(JSON.parse(String(init.body)).fallbacks).toBe("default");
  });

  it("respects the per-request token override", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) => happy());
    await collect(provider(profile, fetch as never), { messages: [{ role: "user", content: "x" }], maxTokens: 123 } as never);
    expect(JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body)).max_tokens).toBe(123);
  });

  it("tells the user when a fallback model answered", async () => {
    const fetch = async () =>
      sse([
        start("claude-opus-4-8"),
        { type: "content_block_start", index: 0, content_block: { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } } },
        stop0,
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Answer" } },
        { type: "content_block_stop", index: 1 },
        msgDelta({ stop_reason: "end_turn" }),
        msgStop,
      ]);
    const events = await collect(provider(profile, fetch));
    expect(textOf(events)).toBe("Answer");
    expect((events.at(-1) as { notice?: string }).notice).toMatch(/Answered by claude-opus-4-8/);
  });

  it("turns a refusal into a clear error and never reports the partial output as done", async () => {
    const fetch = async () =>
      sse([start(), textStart, textDelta("Starting to"), stop0, msgDelta({ stop_reason: "refusal", stop_details: { type: "refusal", category: "bio", explanation: null } }), msgStop]);
    const seen: LlmEvent[] = [];
    const err = await (async () => {
      try {
        for await (const e of provider(profile, fetch).stream({ messages: [{ role: "user", content: "x" }] })) seen.push(e);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ kind: "refusal" });
    expect((err as Error).message).toMatch(/bio safeguard/);
    expect(seen.some((e) => e.type === "done")).toBe(false);
  });

  it("suggests turning fallback on when a model without it refuses", async () => {
    const fetch = async () => sse([start("claude-haiku-4-5"), msgDelta({ stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } }), msgStop]);
    const err = await collect(provider({ ...profile, model: "claude-haiku-4-5" }, fetch)).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "refusal" });
    expect((err as Error).message).toMatch(/Try a different model/);
  });

  it("retries once without fallback if the API rejects the beta before any output", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) => happy());
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "unsupported beta" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const events = await collect(provider(profile, fetch as never));
    expect(textOf(events)).toBe("Hello, wörld");
    expect(fetch).toHaveBeenCalledTimes(2);
    const second = fetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(second[1].body))).not.toHaveProperty("fallbacks");
    expect(new Headers(second[1].headers).get("anthropic-beta")).toBeNull();
  });

  it("reports the real error when the plain retry fails too", async () => {
    const bad = () =>
      new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "max_tokens is too large" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    const fetch = vi.fn(async (..._a: unknown[]) => bad());
    const err = await collect(provider(profile, fetch as never)).catch((e: unknown) => e);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(err).toMatchObject({ kind: "bad_request", status: 400 });
    expect((err as Error).message).toContain("max_tokens is too large");
  });

  it("does not retry other models or non-400 errors", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } }));
    const err = await collect(provider(profile, fetch as never)).catch((e: unknown) => e);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(err).toMatchObject({ kind: "auth", status: 401 });
    expect((err as Error).message).toContain("invalid x-api-key");
  });

  it("maps other HTTP failures", async () => {
    const mk = (status: number) => provider(profile, async () => new Response(JSON.stringify({ type: "error", error: { type: "x", message: "m" } }), { status, headers: { "content-type": "application/json" } }));
    expect(await collect(mk(404)).catch((e: unknown) => e)).toMatchObject({ kind: "not_found" });
    expect(await collect(mk(429)).catch((e: unknown) => e)).toMatchObject({ kind: "rate_limit" });
    expect(await collect(mk(529)).catch((e: unknown) => e)).toMatchObject({ kind: "server" });
  });

  it("turns a connection failure into a friendly network error", async () => {
    const err = await collect(provider(profile, async () => { throw new TypeError("fetch failed"); })).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "network" });
    expect((err as Error).message).toContain("api.anthropic.com");
  });

  it("surfaces cancellation as an AbortError, not a failure", async () => {
    const controller = new AbortController();
    const fetch = async (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    const pending = collect(provider(profile, fetch as never), { messages: [{ role: "user", content: "x" }], signal: controller.signal } as never).catch((e: unknown) => e);
    setTimeout(() => controller.abort(), 10);
    expect(await pending).toMatchObject({ name: "AbortError" });
  });

  it("validates configuration before any request", async () => {
    const fetch = vi.fn();
    expect(await collect(provider({ ...profile, apiKey: "  " }, fetch as never)).catch((e: unknown) => e)).toMatchObject({ kind: "auth" });
    expect(await collect(provider({ ...profile, model: "" }, fetch as never)).catch((e: unknown) => e)).toMatchObject({ kind: "config" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports max_tokens truncation as the stop reason", async () => {
    const events = await collect(provider(profile, async () => sse([start(), textStart, textDelta("cut"), stop0, msgDelta({ stop_reason: "max_tokens" }), msgStop])));
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "max_tokens" });
  });
});

describe("listModels", () => {
  it("lists model ids", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) =>
      new Response(JSON.stringify({ data: [{ id: "claude-opus-5-5", display_name: "Opus", type: "model", created_at: "2026-01-01T00:00:00Z" }, { id: "claude-haiku-4-5", display_name: "Haiku", type: "model", created_at: "2025-01-01T00:00:00Z" }], has_more: false, first_id: "a", last_id: "b" }), { headers: { "content-type": "application/json" } }),
    );
    const ids = await provider(profile, fetch as never).listModels();
    expect(ids).toEqual(["claude-opus-5-5", "claude-haiku-4-5"]);
    expect(String((fetch.mock.calls[0] as [string])[0])).toContain("/v1/models");
  });

  it("maps auth failures", async () => {
    const fetch = async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } }), { status: 401, headers: { "content-type": "application/json" } });
    expect(await provider(profile, fetch).listModels().catch((e: unknown) => e)).toMatchObject({ kind: "auth" });
  });
});
