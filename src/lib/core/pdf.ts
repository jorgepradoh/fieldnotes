/**
 * pdf.js loading shared by the viewer and the importer (one worker setup).
 *
 * Uses pdf.js's "legacy" build: the default one assumes very recent JavaScript
 * (e.g. Map.prototype.getOrInsertComputed) and fails with "is not a function"
 * in the WebKitGTK / WebView2 / WKWebView versions many people still run. The
 * legacy build is the same API with the missing features polyfilled.
 */
export async function loadPdfjs(): Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  return pdfjs;
}

export interface PdfInfo {
  title: string | null;
  author: string | null;
  pages: number;
}

/** Title / author / page count from the PDF's own metadata. Throws if it cannot be parsed. */
export async function readPdfInfo(data: Uint8Array): Promise<PdfInfo> {
  const pdfjs = await loadPdfjs();
  // pdf.js transfers the buffer to its worker — hand it a copy.
  const task = pdfjs.getDocument({ data: data.slice() });
  try {
    const doc = await task.promise;
    const meta = await doc.getMetadata();
    const info = (meta.info ?? {}) as Record<string, unknown>;
    const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    return { title: text(info.Title), author: text(info.Author), pages: doc.numPages };
  } finally {
    // Also runs when parsing fails (encrypted or corrupt file), so a failed import doesn't leak the task.
    await task.destroy().catch(() => undefined);
  }
}
