/**
 * Provider profiles: the presets users start from, validation, and
 * normalising the stored file. Pure — the reactive store is settings.svelte.ts.
 */
import type { ProviderKind, ProviderProfile } from "./types";

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Left empty for non-Anthropic presets: model names go stale, so the user picks one. */
  model: string;
  maxTokens: number;
  needsKey: boolean;
  hint: string;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-opus-5-5",
    maxTokens: 16000,
    needsKey: true,
    hint: "Create a key at console.anthropic.com. If the safeguards decline a request, it is re-run on a fallback model automatically (can be turned off below).",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    maxTokens: 4096,
    needsKey: true,
    hint: "Create a key at platform.openai.com, then use “Load models” to pick one.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "",
    maxTokens: 4096,
    needsKey: true,
    hint: "One key for many hosted models. Model ids look like provider/model.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    model: "",
    maxTokens: 4096,
    needsKey: false,
    hint: "Ollama's default context window is small and silently cuts long prompts. Start it with a larger one, e.g. OLLAMA_CONTEXT_LENGTH=16384, or lower the paper count.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    model: "",
    maxTokens: 4096,
    needsKey: false,
    hint: "Start the local server in LM Studio and load the model with a large enough context length.",
  },
  {
    id: "custom",
    label: "Other OpenAI-compatible",
    kind: "openai-compatible",
    baseUrl: "",
    model: "",
    maxTokens: 4096,
    needsKey: false,
    hint: "Any server with /chat/completions: vLLM, llama.cpp, LiteLLM, Together, Groq… The base URL usually ends in /v1. Plain http works only for localhost.",
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function newProfile(preset: ProviderPreset, id: string = globalThis.crypto.randomUUID()): ProviderProfile {
  return {
    id,
    name: preset.label.replace(/ \(.*\)$/, ""),
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    apiKey: "",
    model: preset.model,
    maxTokens: preset.maxTokens,
  };
}

/** Why this profile cannot be used yet, or null if it can. */
export function profileProblem(profile: ProviderProfile | undefined): string | null {
  if (!profile) return "Set up a model first.";
  if (profile.kind === "anthropic" && !profile.apiKey.trim()) return "Add your Anthropic API key.";
  if (profile.kind === "openai-compatible") {
    let ok = false;
    try {
      const url = new URL(profile.baseUrl.trim());
      ok = url.protocol === "http:" || url.protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok) return "Enter the server's base URL (for example http://localhost:11434/v1).";
  }
  if (!profile.model.trim()) return "Choose a model.";
  return null;
}

export interface AiFile {
  version: 1;
  activeId: string;
  profiles: ProviderProfile[];
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** Validate what was read from ai.json; unusable entries are dropped, never trusted. */
export function normalizeAiFile(raw: unknown): AiFile {
  const empty: AiFile = { version: 1, activeId: "", profiles: [] };
  if (typeof raw !== "object" || raw === null) return empty;
  const list = (raw as { profiles?: unknown }).profiles;
  if (!Array.isArray(list)) return empty;

  const profiles: ProviderProfile[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = str(e.id);
    if (!id || profiles.some((p) => p.id === id)) continue;
    const kind: ProviderKind = e.kind === "anthropic" ? "anthropic" : "openai-compatible";
    const maxTokens = typeof e.maxTokens === "number" && Number.isFinite(e.maxTokens) ? Math.round(e.maxTokens) : kind === "anthropic" ? 16000 : 4096;
    profiles.push({
      id,
      name: str(e.name, "Model") || "Model",
      kind,
      baseUrl: str(e.baseUrl),
      apiKey: str(e.apiKey),
      model: str(e.model),
      maxTokens: Math.min(200_000, Math.max(256, maxTokens)),
      tokenParam:
        e.tokenParam === "max_tokens" || e.tokenParam === "max_completion_tokens" || e.tokenParam === "auto"
          ? e.tokenParam
          : undefined,
      refusalFallback: typeof e.refusalFallback === "boolean" ? e.refusalFallback : undefined,
    });
  }
  const requested = str((raw as { activeId?: unknown }).activeId);
  const activeId = profiles.some((p) => p.id === requested) ? requested : (profiles[0]?.id ?? "");
  return { version: 1, activeId, profiles };
}
