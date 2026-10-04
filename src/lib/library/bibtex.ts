/**
 * BibTeX import: a tolerant parser (nested braces, "quoted" values, @string
 * macros, `#` concatenation, month macros, parenthesised entries) and a mapper
 * from entries to the app's Paper model. Bad entries are skipped and reported
 * rather than failing the whole file.
 */
import { arxivIdFromDoi, normalizeArxivId, normalizeDoi } from "../sources/merge";
import type { Paper } from "../sources/types";

export interface BibEntry {
  type: string;
  key: string;
  /** Lower-cased field names; values with macros expanded but TeX not yet cleaned. */
  fields: Record<string, string>;
}

export interface BibParseResult {
  entries: BibEntry[];
  /** Human-readable notes about anything that could not be read. */
  problems: string[];
}

const MONTHS: Record<string, string> = {
  jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
  jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December",
};

const isSpace = (c: string): boolean => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f";

export function parseBibtex(text: string): BibParseResult {
  const entries: BibEntry[] = [];
  const problems: string[] = [];
  const macros = new Map<string, string>(Object.entries(MONTHS));
  const n = text.length;
  let i = 0;

  const skipSpace = (): void => {
    while (i < n && isSpace(text[i])) i++;
  };

  const lineOf = (pos: number): number => text.slice(0, pos).split("\n").length;

  /** Read a {braced} group starting at `{`; returns the inside and moves past the `}`. */
  const readBraced = (): string => {
    let depth = 0;
    const start = i + 1;
    for (; i < n; i++) {
      const c = text[i];
      if (c === "\\") i++;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        const inner = text.slice(start, i);
        i++;
        return inner;
      }
    }
    return text.slice(start); // unterminated: take what is there
  };

  const readQuoted = (): string => {
    let depth = 0;
    const start = i + 1;
    for (i = start; i < n; i++) {
      const c = text[i];
      if (c === "\\") i++;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === '"' && depth <= 0) {
        const inner = text.slice(start, i);
        i++;
        return inner;
      }
    }
    return text.slice(start);
  };

  /** One value: pieces joined by `#`, each braced, quoted, a number or a macro name. */
  const readValue = (): string => {
    let out = "";
    for (;;) {
      skipSpace();
      const c = text[i];
      if (c === "{") out += readBraced();
      else if (c === '"') out += readQuoted();
      else {
        const start = i;
        while (i < n && !isSpace(text[i]) && !",#{}()\"".includes(text[i])) i++;
        const token = text.slice(start, i);
        if (!token) break;
        out += /^\d+$/.test(token) ? token : (macros.get(token.toLowerCase()) ?? token);
      }
      skipSpace();
      if (text[i] === "#") i++;
      else break;
    }
    return out;
  };

  const skipBalanced = (): void => {
    // At an opening { or ( — skip to its match.
    const open = text[i];
    const close = open === "(" ? ")" : "}";
    let depth = 0;
    for (; i < n; i++) {
      const c = text[i];
      if (c === "\\") i++;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        i++;
        return;
      }
    }
  };

  while (i < n) {
    const at = text.indexOf("@", i);
    if (at === -1) break;
    i = at + 1;
    const typeStart = i;
    while (i < n && /[A-Za-z]/.test(text[i])) i++;
    const type = text.slice(typeStart, i).toLowerCase();
    skipSpace();
    if (!type || (text[i] !== "{" && text[i] !== "(")) continue; // an @ in prose, or a bare email address

    if (type === "comment" || type === "preamble") {
      skipBalanced();
      continue;
    }

    const close = text[i] === "(" ? ")" : "}";
    i++;

    if (type === "string") {
      skipSpace();
      const nameStart = i;
      while (i < n && !isSpace(text[i]) && text[i] !== "=" && text[i] !== close) i++;
      const name = text.slice(nameStart, i).toLowerCase();
      skipSpace();
      if (text[i] === "=") {
        i++;
        macros.set(name, readValue());
      }
      skipSpace();
      if (text[i] === close) i++;
      continue;
    }

    // Citation key runs up to the first comma.
    const keyStart = i;
    while (i < n && text[i] !== "," && text[i] !== close) i++;
    const key = text.slice(keyStart, i).trim();
    const fields: Record<string, string> = {};
    let closed = false;

    while (i < n) {
      while (i < n && (isSpace(text[i]) || text[i] === ",")) i++;
      if (text[i] === close) {
        i++;
        closed = true;
        break;
      }
      const nameStart = i;
      while (i < n && !isSpace(text[i]) && !"=,{}()\"#".includes(text[i])) i++;
      const name = text.slice(nameStart, i).toLowerCase();
      skipSpace();
      if (!name || text[i] !== "=") {
        // Malformed field: skip to the next comma or the end of the entry.
        problems.push(`Line ${lineOf(nameStart)}: could not read a field in “${key || type}”.`);
        while (i < n && text[i] !== "," && text[i] !== close) {
          if (text[i] === "{") skipBalanced();
          else i++;
        }
        continue;
      }
      i++;
      fields[name] = readValue();
    }

    // Line numbers cost a scan of the text, so they are only worked out for problems.
    if (!closed) problems.push(`Line ${lineOf(at)}: the entry “${key || type}” is not closed; kept what was readable.`);
    if (Object.keys(fields).length === 0) {
      problems.push(`Line ${lineOf(at)}: the entry “${key || type}” has no fields.`);
      continue;
    }
    entries.push({ type, key, fields });
  }

  return { entries, problems };
}

// ------------------------------------------------------------- TeX → text

const LETTER_ACCENTS: Record<string, string> = {
  "'": "́", "`": "̀", "^": "̂", '"': "̈", "~": "̃", "=": "̄", ".": "̇",
  u: "̆", v: "̌", H: "̋", c: "̧", k: "̨", r: "̊", d: "̣", b: "̱",
};

const SPECIAL_LETTERS: Record<string, string> = {
  ss: "ß", o: "ø", O: "Ø", aa: "å", AA: "Å", ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", l: "ł", L: "Ł", i: "ı", j: "ȷ",
};

/** Best-effort LaTeX → plain Unicode for the fields we show (titles, authors, venues, abstracts). */
export function cleanTex(input: string): string {
  let s = input;
  // \'{e}  \'e  \'{\i}  {\"o}  \c{c}  \v s
  s = s.replace(/\\(['`^"~=.])\s*\{?\s*(?:\\([ij])|([A-Za-z]))\s*\}?/g, (_m, accent: string, dotless: string | undefined, letter: string | undefined) => {
    const base = dotless ? (dotless === "i" ? "i" : "j") : (letter as string);
    return base + LETTER_ACCENTS[accent];
  });
  s = s.replace(/\\([uvHckrdb])(?:\s*\{\s*([A-Za-z])\s*\}|\s+([A-Za-z]))/g, (_m, accent: string, a: string | undefined, b: string | undefined) => (a ?? (b as string)) + LETTER_ACCENTS[accent]);
  s = s.replace(/\\(ss|aa|AA|ae|AE|oe|OE|o|O|l|L)(?![A-Za-z])\s*(?:\{\})?/g, (_m, name: string) => SPECIAL_LETTERS[name]);
  s = s.replace(/\\([&%_$#{}])/g, "$1");
  // Formatting commands keep their argument: \emph{x} \textbf{x} …
  for (let pass = 0; pass < 4; pass++) {
    const next = s.replace(/\\(?:emph|textit|textbf|textsc|texttt|textrm|textsf|textup|mathrm|mathbf|mathit|mathcal|mathbb|text|url|href)\s*\{([^{}]*)\}/g, "$1");
    if (next === s) break;
    s = next;
  }
  s = s.replace(/---/g, "—").replace(/--/g, "–").replace(/~/g, " ");
  s = s.replace(/\$([^$]*)\$/g, "$1");
  s = s.replace(/\\[A-Za-z]+\s?/g, ""); // any other command: drop the command, keep the text around it
  s = s.replace(/[{}]/g, ""); // case-protection braces
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------ entry → Paper

/** Split on top-level " and ", ignoring any inside braces ({Smith and Sons, Inc.}). */
function splitAuthors(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  const tokens = raw.split(/(\s+)/);
  for (const token of tokens) {
    if (depth === 0 && token.toLowerCase() === "and") {
      parts.push(current);
      current = "";
      continue;
    }
    for (const c of token) {
      if (c === "{") depth++;
      else if (c === "}") depth = Math.max(0, depth - 1);
    }
    current += token;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function formatName(raw: string): string {
  const braced = /^\{[^{}]*\}$/.test(raw.trim()); // {World Health Organization}: a corporate author
  const cleaned = cleanTex(raw);
  if (braced) return cleaned;
  const commaParts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
  if (commaParts.length === 2) return `${commaParts[1]} ${commaParts[0]}`;
  if (commaParts.length >= 3) return `${commaParts[2]} ${commaParts[0]}, ${commaParts[1]}`;
  return cleaned;
}

export function parseAuthors(raw: string | undefined): string[] {
  if (!raw) return [];
  return splitAuthors(raw)
    .filter((a) => a.toLowerCase() !== "others")
    .map(formatName)
    .filter(Boolean);
}

function pick(fields: Record<string, string>, ...names: string[]): string | null {
  for (const name of names) {
    const v = cleanTex(fields[name] ?? "");
    if (v) return v;
  }
  return null;
}

function arxivIdOf(fields: Record<string, string>): string | null {
  const eprint = cleanTex(fields.eprint ?? "");
  const prefix = cleanTex(fields.archiveprefix ?? fields.eprinttype ?? "").toLowerCase();
  const candidates = [
    prefix === "arxiv" || !prefix ? eprint : "",
    fields.journal ?? "",
    fields.journaltitle ?? "",
    fields.url ?? "",
    fields.note ?? "",
  ];
  for (const c of candidates) {
    const m = c.match(/(?:arxiv:?\s*|arxiv\.org\/(?:abs|pdf)\/)([a-z-]+(?:\.[a-z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i);
    const id = normalizeArxivId(m ? m[1] : c);
    if (id) return id;
  }
  return arxivIdFromDoi(fields.doi);
}

export function entryToPaper(entry: BibEntry, id: string): Paper {
  const f = entry.fields;
  const doi = normalizeDoi(cleanTex(f.doi ?? "")) ?? normalizeDoi(cleanTex(f.url ?? ""));
  const arxivId = arxivIdOf(f);
  const yearText = pick(f, "year") ?? pick(f, "date") ?? "";
  const year = Number.parseInt(yearText.match(/\d{4}/)?.[0] ?? "", 10);
  const rawUrl = pick(f, "url");
  const url = /^https?:\/\//i.test(rawUrl ?? "")
    ? rawUrl
    : doi
      ? `https://doi.org/${doi}`
      : arxivId
        ? `https://arxiv.org/abs/${arxivId}`
        : null;

  const authors = parseAuthors(f.author ?? f.editor);
  return {
    id,
    source: "bibtex",
    title: pick(f, "title", "booktitle") ?? (entry.key || "Untitled"),
    authors,
    year: Number.isFinite(year) ? year : null,
    venue:
      pick(f, "journal", "journaltitle", "booktitle", "series", "publisher", "school", "institution", "howpublished") ??
      (arxivId ? "arXiv" : null),
    abstract: pick(f, "abstract"),
    tldr: null,
    citationCount: null,
    url,
    // Only arXiv PDFs are guaranteed open; anything else needs a file attached.
    pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : null,
    doi,
    arxivId,
    citekey: entry.key || undefined,
  };
}

export function bibtexToPapers(text: string, makeId: () => string = () => `local:${globalThis.crypto.randomUUID()}`): {
  papers: Paper[];
  problems: string[];
} {
  const { entries, problems } = parseBibtex(text);
  return { papers: entries.map((e) => entryToPaper(e, makeId())), problems };
}
