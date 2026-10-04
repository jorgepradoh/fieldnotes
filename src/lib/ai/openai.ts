/**
 * OpenAI-compatible Chat Completions over plain REST + SSE. Works with any
 * server that speaks `POST {base}/chat/completions` and `GET {base}/models`:
 * OpenAI, OpenRouter, Ollama (`/v1`), LM Studio, vLLM, llama.cpp, LiteLLM…
 *
 * Deliberately sends a minimal body (model, messages, stream, token limit) —
 * no temperature or stream_options — because strict servers and reasoning
 * models reject parameters they do not know.
 */
import { httpFetch } from "../core/net";
import { errorDetail, isAbort, networkError, statusError } from "./errors";
import { parseSse } from "./sse";
import { LlmError, type ChatRequest, type LlmEvent, type LlmProvider, type ProviderProfile } from "./types";

type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** OpenAI's own API wants max_completion_tokens; everything else still speaks max_tokens. */
export function resolveTokenParam(profile: Pick<ProviderProfile, "baseUrl" | "tokenParam">): "max_tokens" | "max_completion_tokens" {
  if (profile.tokenParam === "max_tokens" || profile.tokenParam === "max_completion_tokens") {
    return profile.tokenParam;
  }
  try {
    return new URL(profile.baseUrl).host === "api.openai.com" ? "max_completion_tokens" : "max_tokens";
  } catch {
    return "max_tokens";
  }
}

interface Chunk {
  choices?: { delta?: { content?: unknown }; message?: { content?: unknown }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  model?: string;
  error?: unknown;
}

function chunkError(chunk: Chunk): LlmError {
  const detail = typeof chunk.error === "string" ? chunk.error : errorDetail(JSON.stringify({ error: chunk.error }));
  return new LlmError("server", `The provider reported an error mid-stream${detail ? `: ${detail}` : "."}`);
}

export function openAiCompatible(profile: ProviderProfile, doFetch: FetchFn = httpFetch): LlmProvider {
  const base = trimBase(profile.baseUrl);

  const headers = (json: boolean): Record<string, string> => {
    const h: Record<string, string> = {};
    if (json) h["content-type"] = "application/json";
    if (profile.apiKey.trim()) h.authorization = `Bearer ${profile.apiKey.trim()}`;
    return h;
  };

  async function request(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(url, init);
    } catch (err) {
      if (isAbort(err)) throw err;
      throw networkError(err, base);
    }
    if (!res.ok) throw statusError(res.status, errorDetail(await res.text().catch(() => "")));
    return res;
  }

  return {
    kind: "openai-compatible",

    async *stream(req: ChatRequest): AsyncGenerator<LlmEvent, void, void> {
      if (!base) throw new LlmError("config", "Set a base URL in the AI settings.");
      if (!profile.model.trim()) throw new LlmError("config", "Choose a model in the AI settings.");

      const messages = [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ];
      const body: Record<string, unknown> = {
        model: profile.model.trim(),
        messages,
        stream: true,
        [resolveTokenParam(profile)]: req.maxTokens ?? profile.maxTokens,
      };

      const res = await request(`${base}/chat/completions`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(body),
        signal: req.signal,
      });

      let stopReason: string | null = null;
      let model: string | undefined;
      let usage: { inputTokens?: number; outputTokens?: number } | undefined;

      // Some servers ignore stream:true and answer with one JSON document.
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.body || contentType.includes("application/json")) {
        const json = (await res.json()) as Chunk;
        if (json.error) throw chunkError(json);
        const choice = json.choices?.[0];
        const text = choice?.message?.content;
        if (typeof text === "string" && text) yield { type: "text", text };
        yield {
          type: "done",
          stopReason: choice?.finish_reason ?? null,
          model: json.model,
          usage: json.usage
            ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
            : undefined,
        };
        return;
      }

      for await (const sse of parseSse(res.body)) {
        if (sse.data === "[DONE]") break;
        let chunk: Chunk;
        try {
          chunk = JSON.parse(sse.data) as Chunk;
        } catch {
          continue; // keep-alives and vendor extras that are not JSON
        }
        if (chunk.error) throw chunkError(chunk);
        model ??= chunk.model;
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === "string" && delta) yield { type: "text", text: delta };
        if (choice?.finish_reason) stopReason = choice.finish_reason;
        if (chunk.usage) {
          usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
        }
      }
      yield { type: "done", stopReason, model, usage };
    },

    async listModels(signal?: AbortSignal): Promise<string[]> {
      if (!base) throw new LlmError("config", "Set a base URL first.");
      const res = await request(`${base}/models`, { headers: headers(false), signal });
      const json = (await res.json()) as { data?: { id?: unknown }[]; models?: { name?: unknown; id?: unknown }[] };
      const ids = [
        ...(json.data ?? []).map((m) => m.id),
        ...(json.models ?? []).map((m) => m.id ?? m.name),
      ].filter((id): id is string => typeof id === "string" && id.length > 0);
      return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
    },
  };
}
