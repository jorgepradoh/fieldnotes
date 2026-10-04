import type { LibraryEntry } from "./library.svelte";

type AnnotationMap = Record<string, string>;

// ── BibTeX key generation ──────────────────────────────────────────────────

function sanitizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
}

function bibKey(entry: LibraryEntry): string {
  const { paper } = entry;
  if (paper.arxivId) return `arxiv_${paper.arxivId.replace(/\./g, "_")}`;
  const firstAuthor = paper.authors[0]?.split(" ").pop() ?? "unknown";
  const firstWord = paper.title.split(/\s+/)[0] ?? "paper";
  const year = paper.year ?? "nd";
  return sanitizeKey(`${firstAuthor}${year}${firstWord}`);
}

// ── BibTeX serializer ──────────────────────────────────────────────────────

function escapeBib(s: string): string {
  return s.replace(/[{}]/g, "").replace(/\\/g, "\\\\");
}

function formatBibAuthors(authors: string[]): string {
  return authors.map((a) => escapeBib(a)).join(" and ");
}

function paperToBibTeX(entry: LibraryEntry, annotation?: string): string {
  const { paper } = entry;
  const key = bibKey(entry);
  const hasAuthorsAndYear = paper.authors.length > 0 && paper.year != null;
  const type = hasAuthorsAndYear ? "article" : "misc";

  const fields: [string, string][] = [
    ["title", `{${escapeBib(paper.title)}}`],
  ];
  if (paper.authors.length > 0) {
    fields.push(["author", `{${formatBibAuthors(paper.authors)}}`]);
  }
  if (paper.year != null) fields.push(["year", `{${paper.year}}`]);
  if (paper.venue) fields.push(["journal", `{${escapeBib(paper.venue)}}`]);
  if (paper.doi) fields.push(["doi", `{${escapeBib(paper.doi)}}`]);
  if (paper.arxivId) {
    fields.push(["eprint", `{${paper.arxivId}}`]);
    fields.push(["archivePrefix", "{arXiv}"]);
    if (paper.venue) fields.push(["primaryClass", `{${escapeBib(paper.venue)}}`]);
  }
  if (paper.url) fields.push(["url", `{${escapeBib(paper.url)}}`]);
  if (annotation) fields.push(["annote", `{${escapeBib(annotation)}}`]);

  const body = fields.map(([k, v]) => `  ${k} = ${v}`).join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}

export function toBibTeX(entries: LibraryEntry[], annotations: AnnotationMap): string {
  return entries.map((e) => paperToBibTeX(e, annotations[e.paper.id])).join("\n\n");
}

// ── Markdown serializer ────────────────────────────────────────────────────

function paperToMarkdown(entry: LibraryEntry, annotation?: string): string {
  const { paper } = entry;
  const lines: string[] = [`## ${paper.title}`, ""];
  if (paper.authors.length > 0) lines.push(`**Authors:** ${paper.authors.join("; ")}  `);
  if (paper.year != null) lines.push(`**Year:** ${paper.year}  `);
  if (paper.venue) lines.push(`**Venue:** ${paper.venue}  `);
  if (paper.doi) lines.push(`**DOI:** ${paper.doi}  `);
  if (paper.arxivId) lines.push(`**arXiv:** ${paper.arxivId}  `);
  if (paper.url) lines.push(`**URL:** <${paper.url}>  `);
  if (paper.abstract) {
    lines.push("", "### Abstract", "", paper.abstract);
  }
  if (annotation) {
    lines.push("", "### Notes", "", annotation);
  }
  return lines.join("\n");
}

export function toMarkdown(entries: LibraryEntry[], annotations: AnnotationMap): string {
  const date = new Date().toISOString().slice(0, 10);
  const header = `# Research Library Export\n*Generated: ${date} · ${entries.length} paper${entries.length === 1 ? "" : "s"}*`;
  const body = entries.map((e) => paperToMarkdown(e, annotations[e.paper.id])).join("\n\n---\n\n");
  return `${header}\n\n---\n\n${body}\n`;
}

// ── JSON serializer ────────────────────────────────────────────────────────

export function toJSON(entries: LibraryEntry[], annotations: AnnotationMap): string {
  const payload = entries.map((e) => ({
    paper: e.paper,
    savedAt: new Date(e.addedAt).toISOString(),
    annotation: annotations[e.paper.id] ?? "",
  }));
  return JSON.stringify(payload, null, 2);
}
