import { describe, expect, it, vi } from "vitest";
import { openAiCompatible, resolveTokenParam, trimBase } from "./openai";
import { LlmError, type LlmEvent, type ProviderProfile } from "./types";

const profile: ProviderProfile = {
  id: "p",
  name: "Local",
  kind: "openai-compatible",
  baseUrl: "http://localhost:11434/v1/",
  apiKey: "",
  model: "llama3.1",
  maxTokens: 2048,
};

function sseResponse(lines: string[], chunkSize = 17, status = 200): Response {
  const bytes = new TextEncoder().encode(lines.join(""));
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += chunkSize) c.enqueue(bytes.slice(i, i + chunkSize));
        c.close();
      },
    }),
    { status, headers: { "content-type": "text/event-stream" } },
  );
}

const data = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (content: string | null, extra: Record<string, unknown> = {}) =>
  data({ model: "llama3.1", choices: [{ index: 0, delta: { content }, finish_reason: null }], ...extra });

async function run(provider: ReturnType<typeof openAiCompatible>, req = { messages: [{ role: "user" as const, content: "hi" }] }) {
  const events: LlmEvent[] = [];
  for await (const e of provider.stream(req)) events.push(e);
  return events;
}

const textOf = (events: LlmEvent[]): string =>
  events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");

describe("trimBase / resolveTokenParam", () => {
  it("trims trailing slashes and whitespace", () => {
    expect(trimBase(" http://x/v1/// ")).toBe("http://x/v1");
  });

  it("uses max_completion_tokens only for api.openai.com unless overridden", () => {
    expect(resolveTokenParam({ baseUrl: "https://api.openai.com/v1" })).toBe("max_completion_tokens");
    expect(resolveTokenParam({ baseUrl: "http://localhost:11434/v1" })).toBe("max_tokens");
    expect(resolveTokenParam({ baseUrl: "https://openrouter.ai/api/v1" })).toBe("max_tokens");
    expect(resolveTokenParam({ baseUrl: "http://x", tokenParam: "max_completion_tokens" })).toBe("max_completion_tokens");
    expect(resolveTokenParam({ baseUrl: "https://api.openai.com/v1", tokenParam: "max_tokens" })).toBe("max_tokens");
    expect(resolveTokenParam({ baseUrl: "not a url" })).toBe("max_tokens");
  });
});

describe("stream", () => {
  it("streams deltas split across small chunks and reports the stop reason", async () => {
    const fetch = vi.fn(async () =>
      sseResponse([
        delta("Hel"),
        delta("lo "),
        delta("wörld"),
        data({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]\n\n",
      ]),
    );
    const events = await run(openAiCompatible(profile, fetch));
    expect(textOf(events)).toBe("Hello wörld");
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "stop", model: "llama3.1" });
  });

  it("sends a minimal request body and the right URL", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) => sseResponse(["data: [DONE]\n\n"]));
    await run(openAiCompatible(profile, fetch), { messages: [{ role: "user", content: "hi" }], system: "be brief" } as never);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      model: "llama3.1",
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
      stream: true,
      max_tokens: 2048,
    });
    // No key configured → no Authorization header (local servers).
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("sends the bearer token and max_completion_tokens to OpenAI", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) => sseResponse(["data: [DONE]\n\n"]));
    await run(openAiCompatible({ ...profile, baseUrl: "https://api.openai.com/v1", apiKey: " sk-test " }, fetch));
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init.body));
    expect(body.max_completion_tokens).toBe(2048);
    expect(body.max_tokens).toBeUndefined();
  });

  it("honours a per-request token limit", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) => sseResponse(["data: [DONE]\n\n"]));
    await run(openAiCompatible(profile, fetch), { messages: [{ role: "user", content: "x" }], maxTokens: 99 } as never);
    expect(JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body)).max_tokens).toBe(99);
  });

  it("ignores null deltas, reasoning fields, comments and non-JSON lines", async () => {
    const events = await run(
      openAiCompatible(
        profile,
        async () =>
          sseResponse([
            ": keep-alive\n\n",
            "data: not json\n\n",
            data({ choices: [{ delta: { role: "assistant", content: null } }] }),
            data({ choices: [{ delta: { reasoning_content: "thinking…" } }] }),
            delta("answer"),
            "data: [DONE]\n\n",
          ]),
      ),
    );
    expect(textOf(events)).toBe("answer");
  });

  it("reads usage when the server includes it", async () => {
    const events = await run(
      openAiCompatible(profile, async () =>
        sseResponse([delta("x"), data({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }), "data: [DONE]\n\n"]),
      ),
    );
    expect(events.at(-1)).toMatchObject({ usage: { inputTokens: 12, outputTokens: 3 } });
  });

  it("surfaces length truncation as the stop reason", async () => {
    const events = await run(
      openAiCompatible(profile, async () =>
        sseResponse([delta("cut"), data({ choices: [{ delta: {}, finish_reason: "length" }] }), "data: [DONE]\n\n"]),
      ),
    );
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "length" });
  });

  it("accepts a non-streaming JSON answer from a server that ignores stream:true", async () => {
    const events = await run(
      openAiCompatible(
        profile,
        async () =>
          new Response(
            JSON.stringify({ model: "m", choices: [{ message: { content: "whole answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2 } }),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    );
    expect(textOf(events)).toBe("whole answer");
    expect(events.at(-1)).toMatchObject({ stopReason: "stop", usage: { inputTokens: 1, outputTokens: 2 } });
  });

  it("throws a mid-stream provider error", async () => {
    const p = openAiCompatible(profile, async () =>
      sseResponse([delta("partial"), data({ error: { message: "upstream exploded", code: 500 } })]),
    );
    await expect(run(p)).rejects.toThrow(/upstream exploded/);
  });
});

describe("errors", () => {
  const failWith = (status: number, body: unknown) =>
    openAiCompatible(profile, async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

  it.each([
    [401, "auth", /rejected the API key/],
    [403, "auth", /rejected the API key/],
    [404, "not_found", /base URL and the model/],
    [429, "rate_limit", /rate limiting/],
    [500, "server", /server error/],
    [400, "bad_request", /rejected the request/],
  ])("maps HTTP %i to %s", async (status, kind, message) => {
    const err = await run(failWith(status, { error: { message: "details here" } })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ kind, status });
    expect((err as Error).message).toMatch(message);
    expect((err as Error).message).toContain("details here");
  });

  it("tolerates plain-text error bodies", async () => {
    const err = await run(failWith(502, "Bad Gateway")).catch((e: unknown) => e);
    expect((err as Error).message).toContain("Bad Gateway");
  });

  it("turns a failed connection into a friendly network error", async () => {
    const p = openAiCompatible(profile, async () => {
      throw new TypeError("error sending request");
    });
    const err = await run(p).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "network" });
    expect((err as Error).message).toContain("localhost:11434");
  });

  it("explains that plain http to a remote host is not allowed, but not for localhost", async () => {
    const boom = async () => {
      throw new TypeError("url not allowed on the configured scope");
    };
    const remote = await run(openAiCompatible({ ...profile, baseUrl: "http://192.168.1.50:8080/v1" }, boom)).catch((e: unknown) => e);
    expect((remote as Error).message).toMatch(/Plain http is only allowed for localhost/);
    const local = await run(openAiCompatible({ ...profile, baseUrl: "http://127.0.0.1:1234/v1" }, boom)).catch((e: unknown) => e);
    expect((local as Error).message).not.toMatch(/Plain http/);
    const secure = await run(openAiCompatible({ ...profile, baseUrl: "https://llm.example.com/v1" }, boom)).catch((e: unknown) => e);
    expect((secure as Error).message).not.toMatch(/Plain http/);
  });

  it("lets aborts through untouched", async () => {
    const p = openAiCompatible(profile, async () => {
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(run(p)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("validates configuration before any request", async () => {
    const fetch = vi.fn();
    await expect(run(openAiCompatible({ ...profile, model: "  " }, fetch as never))).rejects.toMatchObject({ kind: "config" });
    await expect(run(openAiCompatible({ ...profile, baseUrl: " " }, fetch as never))).rejects.toMatchObject({ kind: "config" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("listModels", () => {
  it("lists, de-duplicates and sorts ids from /models", async () => {
    const fetch = vi.fn(async (..._a: unknown[]) =>
      new Response(JSON.stringify({ data: [{ id: "b-model" }, { id: "a-model" }, { id: "b-model" }, {}] })),
    );
    const models = await openAiCompatible(profile, fetch).listModels();
    expect(models).toEqual(["a-model", "b-model"]);
    expect((fetch.mock.calls[0] as [string])[0]).toBe("http://localhost:11434/v1/models");
  });

  it("understands Ollama-style {models:[{name}]}", async () => {
    const models = await openAiCompatible(profile, async () => new Response(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }))).listModels();
    expect(models).toEqual(["llama3.1:8b"]);
  });

  it("reports auth failures", async () => {
    await expect(openAiCompatible(profile, async () => new Response("no", { status: 401 })).listModels()).rejects.toMatchObject({ kind: "auth" });
  });
});
