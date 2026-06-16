import { settings } from "$lib/core/settings.svelte";
import type { LLMProvider, Message } from "./types";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function post(url: string, body: unknown): Promise<Response> {
  const opts: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
  if (inTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, opts) as unknown as Response;
  }
  return globalThis.fetch(url, opts);
}

export const ollamaProvider: LLMProvider = {
  id: "ollama",
  name: "Ollama (local)",

  available(): boolean {
    return Boolean(settings.data.ollamaUrl);
  },

  async complete(messages: Message[]): Promise<string> {
    const baseUrl = settings.data.ollamaUrl;
    if (!baseUrl) throw new Error("Ollama URL not configured");
    const model = settings.data.ollamaModel ?? "llama3.2";

    const res = await post(`${baseUrl}/api/chat`, { model, messages, stream: false });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama ${res.status}: ${text}`);
    }

    const json = (await res.json()) as { message?: { content?: string } };
    return json.message?.content ?? "";
  },
};
