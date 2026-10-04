/**
 * One front door for every file the user hands us — dropped on the window or
 * picked from a dialog. Files are routed by type, added to the library, and
 * reported back through a single summary toast so nothing happens silently.
 *
 *   .pdf            → stored in the library (title read from its metadata if believable)
 *   .md/.markdown   → stored in the library (title/abstract from front matter or first heading)
 *   .bib            → every entry becomes a library record; duplicates are merged
 *   .json           → a fieldnotes layout, added as a new layout
 */
import { bibtexToPapers } from "../library/bibtex";
import {
  MAX_PDF_BYTES,
  MAX_TEXT_BYTES,
  classifyFile,
  looksLikePdf,
  parseMarkdownMeta,
  plausiblePdfTitle,
  titleFromFileName,
} from "../library/files";
import type { Paper } from "../sources/types";
import { emit } from "./bus.svelte";
import { LayoutImportError, MAX_IMPORT_BYTES, describeDropped, parseLayoutImport } from "./layouts";
import { library } from "./library.svelte";
import { readPdfInfo } from "./pdf";
import { getModule } from "./registry";
import { toast } from "./toast.svelte";
import { workspace } from "./workspace.svelte";

export { classifyFile };

export interface ImportSummary {
  pdfs: number;
  markdown: number;
  bibEntries: number;
  /** Already in the library (merged or identical file). */
  duplicates: number;
  layouts: number;
  failed: number;
}

const megabytes = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} MB`;

async function importLayoutFile(file: File): Promise<void> {
  // Any .json is treated as a layout, so bound it before it is read into memory.
  if (file.size > MAX_IMPORT_BYTES) throw new LayoutImportError("That file is too large to be a layout.");
  try {
    const parsed = parseLayoutImport(await file.text(), (id) => getModule(id));
    workspace.addImported(parsed);
    const note = describeDropped(parsed.dropped);
    toast(
      `Imported layout “${parsed.name}” with ${parsed.instances.length} module${parsed.instances.length === 1 ? "" : "s"}.${note ? `\n${note}` : ""}`,
      "success",
    );
  } catch (err) {
    if (err instanceof LayoutImportError) throw err;
    throw new Error("Could not read that file.");
  }
}

async function importPdf(file: File): Promise<{ paper: Paper; isNew: boolean }> {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(`That PDF is ${megabytes(file.size)}; the limit is ${megabytes(MAX_PDF_BYTES)}.`);
  }
  const data = await file.arrayBuffer();
  if (!looksLikePdf(new Uint8Array(data))) throw new Error("That doesn't look like a PDF.");

  let title: string | null = null;
  let authors: string[] = [];
  try {
    const info = await readPdfInfo(new Uint8Array(data));
    title = plausiblePdfTitle(info.title);
    authors = (info.author ?? "").split(/\s*;\s*|\s+and\s+/i).map((a) => a.trim()).filter(Boolean);
  } catch {
    // Encrypted or oddly built: the file name will do; the viewer reports real problems.
  }
  return library.addDocument({
    data,
    mime: "application/pdf",
    name: file.name,
    kind: "pdf",
    meta: { title: title ?? titleFromFileName(file.name), authors, year: null, abstract: null, venue: null },
  });
}

async function importMarkdown(file: File): Promise<{ paper: Paper; isNew: boolean }> {
  if (file.size > MAX_TEXT_BYTES) {
    throw new Error(`That file is ${megabytes(file.size)}; the limit for text files is ${megabytes(MAX_TEXT_BYTES)}.`);
  }
  const data = await file.arrayBuffer();
  const meta = parseMarkdownMeta(new TextDecoder("utf-8").decode(data), file.name);
  return library.addDocument({
    data,
    mime: "text/markdown",
    name: file.name,
    kind: "markdown",
    meta: { title: meta.title, authors: meta.authors, year: meta.year, abstract: meta.abstract, venue: null },
  });
}

async function importBibtex(file: File, summary: ImportSummary): Promise<void> {
  if (file.size > MAX_TEXT_BYTES * 4) throw new Error("That BibTeX file is unusually large.");
  const { papers, problems } = bibtexToPapers(await file.text());
  if (papers.length === 0) throw new Error("No BibTeX entries found in that file.");
  const { added, merged } = library.addMany(papers);
  summary.bibEntries += added.length;
  summary.duplicates += merged;
  if (problems.length > 0) {
    toast(
      `${file.name}: ${problems.length} problem${problems.length === 1 ? "" : "s"} reading the file; the rest was imported.\n${problems.slice(0, 2).join("\n")}`,
      "info",
    );
  }
}

/** Attach a PDF to an existing library record (e.g. the full text for a BibTeX entry). */
export async function attachPdfToEntry(paperId: string, file: File): Promise<boolean> {
  try {
    if (classifyFile(file) !== "pdf") throw new Error("Choose a PDF file.");
    if (file.size > MAX_PDF_BYTES) {
      throw new Error(`That PDF is ${megabytes(file.size)}; the limit is ${megabytes(MAX_PDF_BYTES)}.`);
    }
    const data = await file.arrayBuffer();
    if (!looksLikePdf(new Uint8Array(data))) throw new Error("That doesn't look like a PDF.");
    const paper = await library.attachFile(paperId, data, file.name, "application/pdf");
    if (!paper) throw new Error("That entry is no longer in the library.");
    toast(`Attached “${file.name}” to “${paper.title}”.`, "success");
    return true;
  } catch (err) {
    toast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, "error");
    return false;
  }
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function describeSummary(s: ImportSummary): string {
  const parts: string[] = [];
  if (s.pdfs) parts.push(plural(s.pdfs, "PDF"));
  if (s.markdown) parts.push(plural(s.markdown, "markdown file"));
  if (s.bibEntries) parts.push(plural(s.bibEntries, "BibTeX entry", "BibTeX entries"));
  let text = parts.length ? `Added ${parts.join(", ")} to your library.` : "";
  if (s.duplicates) text += `${text ? " " : ""}${s.duplicates} already ${s.duplicates === 1 ? "was" : "were"} in it.`;
  return text;
}

export async function importFiles(files: File[]): Promise<ImportSummary> {
  const summary: ImportSummary = { pdfs: 0, markdown: 0, bibEntries: 0, duplicates: 0, layouts: 0, failed: 0 };
  // A drop can land during start-up; the board and library must have been read before they are changed.
  await Promise.all([workspace.whenLoaded(), library.ensureLoaded()]);
  const documents: Paper[] = [];

  for (const file of files) {
    try {
      switch (classifyFile(file)) {
        case "layout":
          await importLayoutFile(file);
          summary.layouts++;
          break;
        case "pdf": {
          const { paper, isNew } = await importPdf(file);
          documents.push(paper);
          if (isNew) summary.pdfs++;
          else summary.duplicates++;
          break;
        }
        case "markdown": {
          const { paper, isNew } = await importMarkdown(file);
          documents.push(paper);
          if (isNew) summary.markdown++;
          else summary.duplicates++;
          break;
        }
        case "bibtex":
          await importBibtex(file, summary);
          break;
        default:
          throw new Error("Unsupported file type. Drop PDFs, markdown, .bib or layout files.");
      }
    } catch (err) {
      summary.failed++;
      toast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  const addedToLibrary = summary.pdfs + summary.markdown + summary.bibEntries > 0;
  const message = describeSummary(summary);
  const extras: string[] = [];

  // One dropped document: show it straight away.
  if (documents.length === 1) {
    emit("paper:selected", { paper: documents[0] });
    if (workspace.ensure("reader")) extras.push("added a Reader to this layout");
  }
  if (addedToLibrary && workspace.ensure("library")) extras.push("added the Library to this layout");

  if (message) toast(extras.length ? `${message}\n(${extras.join(", ")})` : message, "success");
  return summary;
}
