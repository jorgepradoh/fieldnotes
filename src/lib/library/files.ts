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

function frontMatter(text: string): { data: Record<string, string>; body: string } {
  const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
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

  const rawAuthors = unquote((data.authors ?? data.author ?? "").replace(/^\[|\]$/g, ""));
  const authors = rawAuthors
    .split(/\s*,\s*|\s+and\s+/i)
    .map((a) => unquote(a))
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

/** First 32 hex chars of the SHA-256 of the bytes — a stable id for identical files. */
export async function fileId(data: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
