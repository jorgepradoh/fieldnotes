import { arxiv } from "./arxiv";
import { openAlex } from "./openalex";
import { semanticScholar } from "./semanticScholar";
import type { PaperSource } from "./types";
import { zotero } from "./zotero";

/** Order matters: earlier sources win metadata ties when results are merged. */
export const SOURCES: PaperSource[] = [semanticScholar, openAlex, arxiv, zotero];

/** Zotero only answers while the desktop app is running, so it stays off until switched on in Search. */
export const DEFAULT_SOURCE_IDS = SOURCES.filter((s) => s !== zotero).map((s) => s.id);

export function getSource(id: string): PaperSource | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function sourceLabel(id: string): string {
  return getSource(id)?.shortName ?? id;
}
