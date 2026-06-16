import Anthropic from "@anthropic-ai/sdk";
import { settings } from "$lib/core/settings.svelte";
import type { LLMProvider, Message } from "./types";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function resolveFetch(): Promise<typeof globalThis.fetch> {
  if (inTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch as unknown as typeof globalThis.fetch;
  }
  return globalThis.fetch.bind(globalThis);
}

export const anthropicProvider: LLMProvider = {
  id: "anthropic",
  name: "Anthropic (Claude)",

  available(): boolean {
    return Boolean(settings.data.anthropicKey);
  },

  async complete(messages: Message[]): Promise<string> {
    const key = settings.data.anthropicKey;
    if (!key) throw new Error("Anthropic API key not configured");

    const client = new Anthropic({
      apiKey: key,
      fetch: await resolveFetch(),
      // Safe in a desktop app — the key lives in the user's local store, not a public bundle.
      dangerouslyAllowBrowser: true,
    });

    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      messages,
    });

    return response.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
  },
};
