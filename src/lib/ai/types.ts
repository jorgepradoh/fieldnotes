/**
 * Provider-neutral LLM interface. The synthesis module only ever sees
 * `LlmProvider`; whether the bytes come from the Anthropic SDK or an
 * OpenAI-compatible REST endpoint (OpenAI, OpenRouter, Ollama, LM Studio,
 * vLLM, llama.cpp…) is the factory's business.
 */

export type ProviderKind = "anthropic" | "openai-compatible";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  /** Overrides the profile's output limit. */
  maxTokens?: number;
  signal?: AbortSignal;
}

export type LlmEvent =
  | { type: "text"; text: string }
  | {
      type: "done";
      /** Provider's stop reason ("end_turn", "stop", "length", "max_tokens"…). */
      stopReason: string | null;
      /** The model that actually answered, when the provider reports it. */
      model?: string;
      usage?: { inputTokens?: number; outputTokens?: number };
      /** Something worth telling the user, e.g. that a fallback model answered. */
      notice?: string;
    };

export interface LlmProvider {
  readonly kind: ProviderKind;
  /** Yields text deltas, then one `done`. Throws `LlmError` on failure. */
  stream(req: ChatRequest): AsyncGenerator<LlmEvent, void, void>;
  /** Model ids the endpoint offers (for the settings picker). */
  listModels(signal?: AbortSignal): Promise<string[]>;
}

/** One saved model configuration. */
export interface ProviderProfile {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Empty for local servers that need none. Stored on this machine, never exported. */
  apiKey: string;
  model: string;
  /** Output-token limit sent with each request. */
  maxTokens: number;
  /** OpenAI-compatible only: which request field carries the limit. */
  tokenParam?: "auto" | "max_tokens" | "max_completion_tokens";
  /** Anthropic only: let the API re-run a safeguard-declined request on a fallback model. */
  refusalFallback?: boolean;
}

export type LlmErrorKind =
  | "auth"
  | "not_found"
  | "rate_limit"
  | "network"
  | "refusal"
  | "bad_request"
  | "server"
  | "config"
  | "unknown";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
