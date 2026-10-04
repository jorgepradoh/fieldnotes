import { arxiv } from "./arxiv";
import { openAlex } from "./openalex";
import { semanticScholar } from "./semanticScholar";
import type { PaperSource } from "./types";

/** Order matters: earlier sources win metadata ties when results are merged. */
export const SOURCES: PaperSource[] = [semanticScholar, openAlex, arxiv];

export const DEFAULT_SOURCE_IDS = SOURCES.map((s) => s.id);

export function getSource(id: string): PaperSource | undefined {
  return SOURCES.find((s) => s.id === id);
}

export function sourceLabel(id: string): string {
  return getSource(id)?.shortName ?? id;
}
