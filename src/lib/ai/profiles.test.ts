import { describe, expect, it } from "vitest";
import { PRESETS, getPreset, newProfile, normalizeAiFile, profileProblem } from "./profiles";
import type { ProviderProfile } from "./types";

const ok: ProviderProfile = { id: "a", name: "A", kind: "openai-compatible", baseUrl: "http://localhost:11434/v1", apiKey: "", model: "llama3", maxTokens: 4096 };

describe("presets", () => {
  it("have unique ids and sensible shapes", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(p.label).toBeTruthy();
      expect(p.hint).toBeTruthy();
      expect(p.maxTokens).toBeGreaterThanOrEqual(256);
    }
  });

  it("only Anthropic ships a default model; others make the user choose", () => {
    expect(getPreset("anthropic")?.model).toBe("claude-opus-5-5");
    for (const p of PRESETS.filter((x) => x.kind === "openai-compatible")) expect(p.model, p.id).toBe("");
  });

  it("local presets need no key and use http localhost; hosted ones do", () => {
    expect(getPreset("ollama")).toMatchObject({ needsKey: false, baseUrl: "http://localhost:11434/v1" });
    expect(getPreset("lmstudio")).toMatchObject({ needsKey: false, baseUrl: "http://localhost:1234/v1" });
    expect(getPreset("openai")?.needsKey).toBe(true);
    expect(getPreset("openrouter")?.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("warns about Ollama's small default context", () => {
    expect(getPreset("ollama")?.hint).toMatch(/context/i);
  });

  it("newProfile copies the preset, names it without the parenthetical, and starts keyless", () => {
    const p = newProfile(getPreset("ollama")!, "id-1");
    expect(p).toMatchObject({ id: "id-1", name: "Ollama", kind: "openai-compatible", apiKey: "", baseUrl: "http://localhost:11434/v1" });
  });
});

describe("profileProblem", () => {
  it("accepts a complete local profile without a key", () => {
    expect(profileProblem(ok)).toBeNull();
  });

  it("requires a key for Anthropic only", () => {
    const claude: ProviderProfile = { ...ok, kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5", apiKey: "" };
    expect(profileProblem(claude)).toMatch(/API key/);
    expect(profileProblem({ ...claude, apiKey: "k" })).toBeNull();
  });

  it("requires a valid http(s) base URL and a model", () => {
    expect(profileProblem({ ...ok, baseUrl: "" })).toMatch(/base URL/);
    expect(profileProblem({ ...ok, baseUrl: "ftp://x" })).toMatch(/base URL/);
    expect(profileProblem({ ...ok, baseUrl: "localhost:1234" })).toMatch(/base URL/);
    expect(profileProblem({ ...ok, model: "  " })).toMatch(/model/);
  });

  it("handles no profile at all", () => {
    expect(profileProblem(undefined)).toMatch(/Set up/);
  });
});

describe("normalizeAiFile", () => {
  it("round-trips a good file", () => {
    const file = normalizeAiFile({ version: 1, activeId: "a", profiles: [{ ...ok, tokenParam: "max_tokens", refusalFallback: false }] });
    expect(file.activeId).toBe("a");
    expect(file.profiles[0]).toMatchObject({ id: "a", tokenParam: "max_tokens", refusalFallback: false });
  });

  it("returns an empty file for garbage", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { profiles: "no" }]) {
      expect(normalizeAiFile(bad)).toEqual({ version: 1, activeId: "", profiles: [] });
    }
  });

  it("drops entries without an id and de-duplicates ids", () => {
    const file = normalizeAiFile({ profiles: [{ name: "no id" }, { id: "x", name: "one" }, { id: "x", name: "two" }, "junk"] });
    expect(file.profiles.map((p) => p.name)).toEqual(["one"]);
  });

  it("coerces bad field types instead of trusting them", () => {
    const [p] = normalizeAiFile({ profiles: [{ id: "x", name: 5, kind: "weird", baseUrl: null, apiKey: 7, model: {}, maxTokens: "lots", tokenParam: "nope", refusalFallback: "yes" }] }).profiles;
    expect(p).toEqual({ id: "x", name: "Model", kind: "openai-compatible", baseUrl: "", apiKey: "", model: "", maxTokens: 4096, tokenParam: undefined, refusalFallback: undefined });
  });

  it("clamps the token limit and picks a per-kind default", () => {
    const profiles = normalizeAiFile({
      profiles: [
        { id: "lo", maxTokens: 1 },
        { id: "hi", maxTokens: 10_000_000 },
        { id: "claude", kind: "anthropic" },
      ],
    }).profiles;
    expect(profiles.map((p) => p.maxTokens)).toEqual([256, 200_000, 16000]);
  });

  it("falls back to the first profile when activeId is stale", () => {
    expect(normalizeAiFile({ activeId: "gone", profiles: [{ id: "a" }, { id: "b" }] }).activeId).toBe("a");
  });
});
