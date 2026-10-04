/**
 * Anthropic (Claude) provider on the official SDK.
 *
 * The SDK is used in its browser mode with Tauri's Rust-side fetch swapped in,
 * so there is no CORS and the reachable hosts stay pinned by the HTTP scope.
 * `dangerouslyAllowBrowser` is safe here: this is a desktop app and the key is
 * the user's own, never shipped to a web page.
 *
 * The request is deliberately minimal (model, max_tokens, system, messages):
 * thinking, effort and sampling parameters differ per Claude model — some
 * reject ones others require — and the default behaviour of each model is
 * right for summarising.
 */
import Anthropic from "@anthropic-ai/sdk";
import { httpFetch } from "../core/net";
import { errorDetail, networkError, statusError } from "./errors";
import { trimBase } from "./openai";
import { LlmError, type ChatRequest, type LlmEvent, type LlmProvider, type ProviderProfile } from "./types";

type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Models whose safety classifiers can decline a request and that accept `fallbacks: "default"`. */
const FALLBACK_MODELS = /^claude-(fable-5-1|fable-5|opus-5-5|opus-5|sonnet-5-5)$/;

/**
 * Server-side fallback re-runs a safeguard-declined request on another model
 * inside the same call. It exists only on the first-party API and only for
 * the models above; anything else just doesn't get it.
 */
export function supportsServerSideFallback(
  profile: Pick<ProviderProfile, "model" | "baseUrl" | "refusalFallback">,
): boolean {
  if (profile.refusalFallback === false) return false;
  if (!FALLBACK_MODELS.test(profile.model.trim())) return false;
  try {
    return new URL(profile.baseUrl.trim() || DEFAULT_ANTHROPIC_URL).host === "api.anthropic.com";
  } catch {
    return false;
  }
}

interface FinalLike {
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  model: string;
  content: { type: string }[];
  usage: { input_tokens: number; output_tokens: number; iterations?: { type: string }[] | null };
}

function mapSdkError(err: unknown, baseUrl: string): unknown {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new DOMException("Aborted", "AbortError");
  if (err instanceof Anthropic.APIConnectionError) return networkError(err, baseUrl);
  if (err instanceof Anthropic.APIError) {
    const detail = errorDetail(JSON.stringify(err.error ?? {}));
    return err.status ? statusError(err.status, detail) : new LlmError("server", detail || err.message);
  }
  return err;
}

export function anthropicProvider(
  profile: ProviderProfile,
  opts: { fetch?: FetchFn; maxRetries?: number } = {},
): LlmProvider {
  const baseURL = trimBase(profile.baseUrl) || DEFAULT_ANTHROPIC_URL;
  const doFetch = opts.fetch ?? httpFetch;

  const client = (): Anthropic => {
    if (!profile.apiKey.trim()) {
      throw new LlmError("auth", "Add your Anthropic API key in the AI settings.");
    }
    return new Anthropic({
      apiKey: profile.apiKey.trim(),
      baseURL,
      dangerouslyAllowBrowser: true,
      fetch: (input, init) => doFetch(input as string | URL, init),
      maxRetries: opts.maxRetries ?? 2,
    });
  };

  async function* pump(
    stream: AsyncIterable<{ type: string }> & { abort(): void },
    state: { sentText: boolean },
  ): AsyncGenerator<LlmEvent, void, void> {
    try {
      for await (const event of stream) {
        const e = event as { type: string; delta?: { type?: string; text?: string } };
        if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
          state.sentText = true;
          yield { type: "text", text: e.delta.text };
        }
      }
    } finally {
      // Consumer stopped early (Stop button, error): don't leave the request running.
      stream.abort();
    }
  }

  function finish(final: FinalLike, usedFallback: boolean): LlmEvent {
    if (final.stop_reason === "refusal") {
      const category = final.stop_details?.category;
      throw new LlmError(
        "refusal",
        `The model declined this request${category ? ` (${category} safeguard)` : ""}. ` +
          (usedFallback
            ? "No fallback model could answer it either. Try a different model."
            : "Try a different model, or turn on the refusal fallback in the AI settings."),
      );
    }
    const fellBack =
      final.content.some((b) => b.type === "fallback") ||
      (final.usage.iterations ?? []).some((i) => i.type === "fallback_message");
    return {
      type: "done",
      stopReason: final.stop_reason,
      model: final.model,
      usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
      notice: fellBack
        ? `Answered by ${final.model}: the safeguards on ${profile.model.trim()} declined this request.`
        : undefined,
    };
  }

  async function* attempt(
    c: Anthropic,
    req: ChatRequest,
    withFallback: boolean,
    state: { sentText: boolean },
  ): AsyncGenerator<LlmEvent, void, void> {
    const params = {
      model: profile.model.trim(),
      max_tokens: req.maxTokens ?? profile.maxTokens,
      messages: req.messages,
      ...(req.system ? { system: req.system } : {}),
    };
    if (withFallback) {
      const stream = c.beta.messages.stream(
        { ...params, betas: [FALLBACK_BETA], fallbacks: "default" },
        { signal: req.signal },
      );
      yield* pump(stream, state);
      yield finish(await stream.finalMessage(), true);
    } else {
      const stream = c.messages.stream(params, { signal: req.signal });
      yield* pump(stream, state);
      yield finish(await stream.finalMessage(), false);
    }
  }

  return {
    kind: "anthropic",

    async *stream(req: ChatRequest): AsyncGenerator<LlmEvent, void, void> {
      if (!profile.model.trim()) throw new LlmError("config", "Choose a model in the AI settings.");
      const c = client();
      // Fallback is a nicety, never a reason for the request to fail: if the API
      // rejects the beta before any text arrived, ask again without it.
      const plans = supportsServerSideFallback(profile) ? [true, false] : [false];
      for (const withFallback of plans) {
        const state = { sentText: false };
        try {
          yield* attempt(c, req, withFallback, state);
          return;
        } catch (err) {
          const retryPlain = withFallback && !state.sentText && err instanceof Anthropic.BadRequestError;
          if (!retryPlain) throw mapSdkError(err, baseURL);
        }
      }
    },

    async listModels(signal?: AbortSignal): Promise<string[]> {
      const c = client();
      const ids: string[] = [];
      try {
        for await (const model of c.models.list({ limit: 100 }, { signal })) {
          ids.push(model.id);
          if (ids.length >= 300) break;
        }
      } catch (err) {
        throw mapSdkError(err, baseURL);
      }
      return ids;
    },
  };
}
