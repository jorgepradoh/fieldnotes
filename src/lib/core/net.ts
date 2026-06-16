function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Binary downloads (PDFs). Publishers rarely send CORS headers, so inside
 * Tauri this fetches from the Rust side (no CORS); in a plain browser it
 * falls back to window.fetch and works only for CORS-friendly hosts.
 *
 * local:// prefix: read from the local file system via the embedded Rust
 * command (the dialog picker already gates which files the user can select).
 */
export async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (url.startsWith("local://")) {
    const path = url.slice("local://".length);
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = await invoke<number[]>("read_file_bytes", { path });
    return new Uint8Array(bytes);
  }
  const doFetch = inTauri()
    ? (await import("@tauri-apps/plugin-http")).fetch
    : globalThis.fetch;
  const res = await doFetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Routes fetch through the Tauri HTTP plugin (Rust side) so requests aren't
 * blocked by WebView CORS or protocol isolation. Returns a full Response so
 * callers can inspect status codes before consuming the body.
 */
export async function tauriFetch(
  url: string | URL,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
): Promise<Response> {
  const doFetch = inTauri()
    ? (await import("@tauri-apps/plugin-http")).fetch
    : globalThis.fetch;
  return doFetch(url.toString(), init) as Promise<Response>;
}

/**
 * Text/XML downloads. Routes through Tauri HTTP plugin in Tauri to bypass CORS
 * restrictions on APIs (like arXiv) that don't send CORS headers.
 */
export async function fetchText(
  url: string,
  opts?: { headers?: Record<string, string>; signal?: AbortSignal },
): Promise<string> {
  const doFetch = inTauri()
    ? (await import("@tauri-apps/plugin-http")).fetch
    : globalThis.fetch;
  const res = await doFetch(url, { signal: opts?.signal, headers: opts?.headers });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.text();
}
