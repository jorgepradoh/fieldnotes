/**
 * Pure helpers for turning dropped files into library entries: what kind of
 * file is it, what is a believable title, and what can be read out of a
 * markdown document's front matter. The DOM- and IndexedDB-touching parts live
 * in core/importer.ts and core/library.svelte.ts.
 */

export type FileKind = "pdf" | "markdown" | "bibtex" | "layout" | "unsupported";

export const MAX_PDF_BYTES = 150 * 1024 * 1024;
export const MAX_TEXT_BYTES = 8 * 1024 * 1024;

export function classifyFile(file: { name: string; type?: string }): FileKind {
  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (ext === "pdf" || file.type === "application/pdf") return "pdf";
  if (["md", "markdown", "mdown", "txt"].includes(ext)) return "markdown";
  if (["bib", "bibtex"].includes(ext)) return "bibtex";
  if (ext === "json") return "layout";
  return "unsupported";
}

/** True if "%PDF-" appears in the first KB, which is where the spec lets it be. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  const marker = [0x25, 0x50, 0x44, 0x46, 0x2d];
  for (let i = 0; i + marker.length <= head.length; i++) {
    if (marker.every((b, j) => head[i + j] === b)) return true;
  }
  return false;
}

export function titleFromFileName(name: string): string {
  let base = name.replace(/\.[A-Za-z0-9]{1,8}$/, "").replace(/_+/g, " ").trim();
  if (!base.includes(" ")) base = base.replace(/-+/g, " ");
  base = base.replace(/\s+/g, " ").trim();
  return base || name;
}

/**
 * PDF metadata titles are often junk ("Microsoft Word - draft_v3.docx",
 * "untitled", the file name again). Return the title only if it looks like
 * a real one.
 */
export function plausiblePdfTitle(title: string | null | undefined): string | null {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 6 || t.length > 300) return null;
  if (/^(microsoft (word|powerpoint|excel)|untitled|document\d*|slide\s*\d*|powerpoint presentation|presentation\d*)\b/i.test(t)) return null;
  if (/\.(docx?|pptx?|xlsx?|tex|dvi|pdf|indd|rtf|odt|ps)$/i.test(t)) return null;
  if (/^[\d.\-_/\s]+$/.test(t)) return null; // an id like 2304.03442
  if (!/[A-Za-z]/.test(t)) return null;
  return t;
}

export interface MarkdownMeta {
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
}

function unquote(value: string): string {
  const v = value.trim();
  return (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")) ? v.slice(1, -1) : v;
}

const FRONT_MATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

/** The document without its leading YAML front matter (which would otherwise render as a heading). */
export function stripFrontMatter(text: string): string {
  const m = text.match(FRONT_MATTER);
  return m ? text.slice(m[0].length) : text;
}

function frontMatter(text: string): { data: Record<string, string>; body: string } {
  const m = text.match(FRONT_MATTER);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  let listKey: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      listKey = kv[2] === "" ? kv[1].toLowerCase() : null;
      data[kv[1].toLowerCase()] = kv[2];
    } else if (listKey && /^\s*-\s+/.test(line)) {
      data[listKey] = (data[listKey] ? `${data[listKey]}, ` : "") + line.replace(/^\s*-\s+/, "").trim();
    }
  }
  return { data, body: text.slice(m[0].length) };
}

function stripMarkdown(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMarkdownMeta(text: string, fileName: string): MarkdownMeta {
  const { data, body } = frontMatter(text);
  const heading = body.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m)?.[1];
  const title = stripMarkdown(unquote(data.title ?? "")) || (heading ? stripMarkdown(heading) : "") || titleFromFileName(fileName);

  // Split first, then unquote each name: unquoting the whole list would strip only the outer pair
  // of quotes of ["A", "B"] and leave one stray quote on each end.
  const authors = (data.authors ?? data.author ?? "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .split(/\s*,\s*|\s+and\s+/i)
    .map((a) => unquote(a.trim()))
    .filter(Boolean);

  const year = Number.parseInt((data.date ?? data.year ?? "").match(/\d{4}/)?.[0] ?? "", 10);

  // First real paragraph: skip headings, rules, lists, quotes and code fences.
  let abstract: string | null = null;
  let inFence = false;
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    if (lines.some((l) => /^\s*(```|~~~)/.test(l))) {
      inFence = !inFence && lines.filter((l) => /^\s*(```|~~~)/.test(l)).length % 2 === 1;
      continue;
    }
    if (inFence) continue;
    const first = lines[0].trim();
    if (!first || /^(#|---|\*\*\*|___|[-*+]\s|\d+\.\s|>|\|)/.test(first)) continue;
    const flat = stripMarkdown(block);
    if (flat.length < 20) continue;
    abstract = flat.length > 600 ? `${flat.slice(0, 600).replace(/\s+\S*$/, "")}…` : flat;
    break;
  }

  return { title, authors, year: Number.isFinite(year) ? year : null, abstract };
}

/**
 * 128-bit non-cryptographic hash (cyrb128) — only used when SubtleCrypto is
 * missing, which happens outside secure contexts. Ids just need to be stable
 * and collision-resistant for a person's own files.
 */
export function fallbackHash(bytes: Uint8Array): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < bytes.length; i++) {
    const k = bytes[i];
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h1 ^ h2 ^ h3 ^ h4) + hex(h2 ^ h1) + hex(h3 ^ h1) + hex(h4 ^ h1);
}

/** 32 hex chars identifying the bytes: stable for identical files, different otherwise. */
export async function fileId(data: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fallbackHash(new Uint8Array(data));
  const digest = await subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
