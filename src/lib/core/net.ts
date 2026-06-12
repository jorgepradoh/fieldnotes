/**
 * Binary downloads (PDFs). Publishers rarely send CORS headers, so inside
 * Tauri this fetches from the Rust side (no CORS); in a plain browser it
 * falls back to window.fetch and works only for CORS-friendly hosts.
 */
export async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const doFetch =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
      ? (await import("@tauri-apps/plugin-http")).fetch
      : globalThis.fetch;
  const res = await doFetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
