import { anthropicProvider } from "./anthropic";
import { openAiCompatible } from "./openai";
import type { LlmProvider, ProviderProfile } from "./types";

/** The one place that knows which implementation backs which kind. */
export function createProvider(profile: ProviderProfile): LlmProvider {
  return profile.kind === "anthropic" ? anthropicProvider(profile) : openAiCompatible(profile);
}
