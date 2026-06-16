export type { LLMProvider, Message } from "./types";

import { anthropicProvider } from "./anthropic";
import { ollamaProvider } from "./ollama";

/** Returns the first configured provider: Anthropic if a key is set, Ollama if a URL is set. */
export function getProvider() {
  if (anthropicProvider.available()) return anthropicProvider;
  if (ollamaProvider.available()) return ollamaProvider;
  return null;
}
