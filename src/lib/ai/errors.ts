import { LlmError } from "./types";

/** Pull a human message out of the usual JSON error shapes, else a trimmed snippet. */
export function errorDetail(body: string): string {
  const text = body.trim();
  if (!text) return "";
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const err = json.error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const message = (err as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
    for (const key of ["message", "detail"]) {
      if (typeof json[key] === "string") return json[key] as string;
    }
  } catch {
    // not JSON
  }
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export function statusError(status: number, detail: string): LlmError {
  const tail = detail ? ` — ${detail}` : "";
  if (status === 401 || status === 403) {
    return new LlmError("auth", `The provider rejected the API key (HTTP ${status}). Check it in the AI settings.${tail}`, status);
  }
  if (status === 404) {
    return new LlmError("not_found", `Not found (HTTP 404). Check the base URL and the model name.${tail}`, status);
  }
  if (status === 408 || status === 429) {
    return new LlmError("rate_limit", `The provider is rate limiting requests (HTTP ${status}). Wait a moment and try again.${tail}`, status);
  }
  if (status >= 500) {
    return new LlmError("server", `The provider had a server error (HTTP ${status}). Try again shortly.${tail}`, status);
  }
  return new LlmError("bad_request", `The provider rejected the request (HTTP ${status}).${tail}`, status);
}

/** fetch itself failed: DNS, refused connection, TLS, offline, blocked by scope or CORS. */
export function networkError(err: unknown, baseUrl: string): LlmError {
  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch {
    // keep the raw string
  }
  const reason = err instanceof Error ? err.message : String(err);
  // The desktop app only allows plain http to localhost (see capabilities/default.json).
  const blockedHttp = /^http:\/\//i.test(baseUrl.trim()) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(baseUrl.trim());
  const hint = blockedHttp
    ? " Plain http is only allowed for localhost: use https, or add the host to the app's HTTP scope."
    : "";
  return new LlmError(
    "network",
    `Could not reach ${host}. Is the server running and the base URL right?${hint} (${reason})`,
  );
}

export function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
