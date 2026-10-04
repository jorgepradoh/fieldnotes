/** pdf.js loading shared by the viewer and the importer (one worker setup). */
export async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
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
  const doc = await task.promise;
  try {
    const meta = await doc.getMetadata();
    const info = (meta.info ?? {}) as Record<string, unknown>;
    const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
    return { title: text(info.Title), author: text(info.Author), pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}
