# P0b + P1 — CI guardrails, and one record per paper

Implements **P0b** and **P1** of [`v0.3-research-workbench.md`](./v0.3-research-workbench.md) in one
branch (about 1,000 lines of non-test code, under the 1,500-line split threshold). The P0b commit is
self-contained and can be split into its own PR if preferred. Where this file and the master plan
disagree, the code won; the disagreements are listed under *Decisions*.

## Goal

After this session:

1. Every push is checked by CI (`check`, `test`, `build`, production `npm audit`, and a test that the
   npm `@tauri-apps/*` packages and the Rust `tauri*` crates stay on the same minor), and every future
   session loads the repo's guardrails from a root `CLAUDE.md`.
2. A paper is one record. Reading status, tags and notes live on the library entry, so the same paper
   reached from Semantic Scholar, arXiv, OpenAlex or a BibTeX import shows one status, one note and one
   set of tags everywhere. Existing queue and annotation data is carried over without loss.

## Feature 1 — P0b: CI, parity check, `CLAUDE.md`

**Files.** `scripts/tauriParity.ts`, `scripts/tauriParity.test.ts`, `package.json` (one script),
`.github/workflows/ci.yml`, `CLAUDE.md`.

- `checkParity(packageLockText, cargoLockText)` is pure: it parses both lockfiles, pairs
  `@tauri-apps/api` ↔ `tauri` and `@tauri-apps/plugin-X` ↔ `tauri-plugin-X`, and fails when major.minor
  differ, when an npm package has no crate, when a crate appears in several versions, or when it found
  nothing to compare (an empty or unrecognised lockfile must not pass vacuously).
- The CLI half reads the real lockfiles (paths overridable by arguments) and exits 1 on failure. Only
  the npm script and CI read the real lockfiles; `npm test` uses inline fixtures only.
- Run with Node's built-in type stripping (`node --experimental-strip-types`), so no new dependency.
- CI: Node 22, `npm ci` → check → test → build → `npm audit --omit=dev --audit-level=high` → parity. A
  second Linux job runs `cargo check --locked` with Tauri's apt prerequisites. First-party actions only.
- `CLAUDE.md` ≤ 60 lines, distilled from the master plan §1.1–§1.5.

**Verification.**
- Unit: the exact pre-P0a mismatch (npm api 2.12.1 / fs 2.6.0 / dialog 2.8.1 vs crates 2.11.2 / 2.5.1 /
  2.7.2) is reported as three failures; matching versions and patch-only differences pass; the
  guards (no pairs found, missing crate, duplicate crate versions, garbage input) each have a test and
  are mutation-checked once.
- Real files: `npm run check:tauri-parity` passes on the repo as it is; the same CLI pointed at the
  pre-P0a lockfiles (`git show 6582272:…`) fails.
- The workflow is linted with `actionlint` if it can be obtained, otherwise parsed as YAML and reviewed.
  It cannot be run from here → *Not verified*.

## Feature 2 — P1: one record per paper

### Data model (`library.json`, v2, additive)

```ts
type PaperStatus = "to-read" | "reading" | "done";
interface LibraryEntry {
  paper: Paper; addedAt: number;
  status?: PaperStatus; statusAt?: number;   // replaces queue.json
  tags?: string[];                            // trimmed, lower-case, unique, capped
  note?: string;                              // markdown; replaces annotations.json
}
interface LibraryFile {
  version: 2; entries: LibraryEntry[];
  orphanNotes?: Record<string, string>;       // old annotation keyed by an id no entry has (yet)
  migrated?: { queue?: true; annotations?: true };
}
```

- The loader accepts the June bare list `[{paper, savedAt}]`, v1 and v2 and always writes v2. Unknown
  fields are preserved: unknown top-level keys are carried back out, and entries are spread, never
  rebuilt. Invalid *known* fields (a `status` that is not one of the three, a non-array `tags`) are
  dropped on load rather than trusted.
- The state class stays thin. Pure logic moves to `src/lib/library/`:
  `model.ts` (types, file parsing, tag normalisation, `addPapers` — today's `addMany` merge/dedupe logic
  moved verbatim — and orphan-note adoption), `migrate.ts` (queue and annotation migrations) and
  `queue.ts` (columns and advance rules for the Queue view).

### API on `LibraryState`

`idFor(paper)`, `ensure(paper)`, `setStatus(id, status | null)`, `setNote(id, text)`,
`addTag(id, tag)` / `removeTag(id, tag)`, `tags()`, plus `noteOf(id)`, `statusOf(id)` and
`hasOrphanNote(paper)` for the Annotations hint. (The master plan also lists `byStatus`; the Queue uses
the pure `queueColumns` directly, so `byStatus` was dropped as unused.) All writes go through one `persist()`, which now
coalesces: the first write happens immediately (so behaviour and tests are unchanged), writes requested
while one is in flight collapse into a single follow-up write of the latest state. This matters because
notes now live in the same file as the whole library and are saved as the user types. A failed write
is reported once with a toast and retried by itself (5 s, doubling, capped at 60 s); a later edit
writes at once and cancels the pending retry.

### Migrations (run once, inside `load()`, never delete the old files)

The old stores keep their data in `queue.json` (key `queue`) and `annotations.json` (key `annotations`)
in the app-data folder, and in the **raw** `localStorage` keys `queue` / `annotations` in a plain
browser (not the `fieldnotes:<file>:<key>` form `storage.ts` uses), so a `loadLegacy(file, key)` reader
is added next to `loadLegacyWorkspace`.

- **Annotations (runs first)**: for each `id → text` with a non-blank string: if an entry has that id
  the text becomes its note (if that entry already has a different note the two are joined, never
  overwritten); otherwise it is kept in `orphanNotes[id]` and adopted when a paper with that id is
  later added or ensured.
- **Queue (runs second)**: valid entries, oldest first → `addPapers` (so identity merging applies,
  keeping the library's own copy and id, and adopting any note waiting under the id the paper was
  queued as, even if it merges into an entry with another id), then `status` / `statusAt` on the
  resulting record; an existing status wins. A new library entry takes the queue entry's `addedAt`.
  Entries whose status is unknown become `to-read`; entries that are not paper-shaped are skipped.
  *(Originally planned the other way round; review showed a note keyed by a merged-away id would be
  stranded as an orphan.)*
- A legacy file that is absent does nothing. One that is present sets `migrated.<name>` in the same
  write that stores the result, so a repeat run is a no-op. One that cannot be read leaves the flag
  unset (retried next launch) and never blocks the library from loading.
- `orphanNotes` is built with a `Map` and serialised with `Object.fromEntries`, so a hostile key such as
  `__proto__` is stored as data and cannot touch the prototype.

### Modules (ids unchanged so saved layouts still load)

- **Queue**: columns from `library.byStatus`. "+ Queue" = `ensure` then `to-read` (queueing now also
  saves to the library — documented behaviour change). "Remove" in the Done column and the × clear the
  status; the paper stays in the library.
- **Annotations**: reads and writes `entry.note`. An unsaved paper gets "Save to library to add notes"
  with a button (no silent saves), plus a hint when an old note is waiting for it. Pending edits are
  flushed when the selection changes or the module is removed (today a quick switch drops the first
  paper's last edit because one shared timer is cleared).
- **Library**: status selector and tag chips on each row, filters by status and tag (extends
  `library/query.ts`; the text filter also matches tags). Removing a paper deletes its tags and
  status but **keeps its note** waiting under the paper's id (as the old annotations store did), so
  saving the same paper again brings it back; the confirm button's tooltip says so.
- **Export**: BibTeX gets `keywords` (tags), Markdown gets Status / Tags / Notes, JSON gets `status`,
  `tags`, `note` and keeps `annotation` (= `note`) and `savedAt`. The "Include annotations" box controls
  notes only. `toBibTeX/toMarkdown/toJSON` take `{ notes }` instead of an annotations map.
- **Reader / Synthesis / importer** already go through `library.find` / `library.entries` /
  `library.addMany`; nothing needs to change there and they are left alone.
- `core/queue.svelte.ts` and `core/annotations.svelte.ts` are deleted; `+page.svelte` stops loading them.

### Risks

- **Whole-file writes.** Notes are saved by rewriting `library.json`. Mitigated by the 400 ms editor
  debounce and write coalescing; a library of thousands of abstracts plus long notes will make each save
  slower than the old per-notes file. If it shows up in real use, notes can move to their own file
  behind the same API.
- **Downgrade.** An older build reads a v2 file (extra fields are ignored) but rewrites it as v1,
  dropping status, tags and notes. The old files are never touched, so the old data is still there.
- **Orphan notes** for ids the library will never see are kept forever. They are small, and dropping a
  note is worse than keeping one.
- **Identity matches** use the existing `paperKeys` (DOI, arXiv id, title ≥ 25 chars or title + first
  author). A false positive would give two different papers one record; that logic is unchanged.

## Verification plan

- `npm run check` (0/0), `npm test`, `npm run build` before every commit.
- Unit tests, each guard mutation-checked once: v1→v2, bare-list→v2, unknown field preservation, invalid
  known fields; queue and annotation migrations (duplicates, order, identity merge, orphan notes, repeat
  run no-op, partial/corrupt/hostile legacy data incl. `__proto__`, flag only on success); `idFor` /
  `ensure` identity across source ids; status/tag/note API; tag normalisation and caps; persistence
  round trip incl. coalescing; queue view rules; library filter; export formats.
- Chromium (Playwright) against `npm run dev`, then against `npm run build` + `vite preview` (restarted
  after each rebuild), with the paper APIs mocked at the network layer: happy path (search → queue →
  status/notes/tags → export), identity (re-find the same paper through another source), migration from
  seeded legacy `queue` / `annotations` / bare-list library, failure paths (corrupt legacy data, a
  failing source, a failing storage write), persistence across a reload, and a clean console.
- Security pass: no new `{@html}`; notes still render only through `core/markdown.ts`; tags and
  statuses are rendered as text; exports are inspected for injection through tag/note content; no new
  dependency (`npm audit --omit=dev`); no Tauri capability or Rust change.

## Decisions (overrule in review)

1. **One PR, two feature commits groups.** The branch is a single session branch and the total is under
   1,500 lines, so P0b and P1 ship together; P0b is its own commit.
2. **Legacy browser keys.** The old stores wrote bare `queue` / `annotations` keys to `localStorage`;
   migration reads those (the plan did not mention the difference).
3. **No flag for absent legacy data.** Acting only when an old file exists is what the plan says; the
   cost of re-checking is one cheap read per launch.
4. **`persist()` coalesces** (see above) — an addition to the plan, needed once notes live here.
5. **Conflicting notes are joined, not overwritten**, with a `---` separator.
6. **Tags**: lower-case, whitespace collapsed, leading `#` removed, `,` and `;` replaced by a space,
   ≤ 40 characters, ≤ 30 per entry; the Library input splits on commas.
7. **Done column**: "Remove" and × clear the status only; the paper stays in the library.
8. **Export**: the "Include annotations" checkbox controls notes; status and tags are always exported.
9. **`LibraryEntry` and friends move to `library/model.ts`** (a plain `.ts`, importable without runes).
10. **`check:tauri-parity` needs Node ≥ 22.6** (type stripping); the rest of the repo still needs only 20.
11. **CI uses first-party actions only**, pinned by major tag, not by SHA; a `cargo check` job uses the
    runner's preinstalled Rust instead of a third-party toolchain action.
12. **Annotations flush-on-switch** fixes an existing dropped-edit bug in a module this change rewrites.
13. **Removal keeps the note** (orphan) instead of deleting it with the entry (after review).
14. **Write failures are surfaced and retried** rather than only logged (after review).
15. **Annotations migrate before the queue** (after review; see Migrations).
16. **An exact id match is the record; otherwise the first entry sharing an identity key**, in `addPapers`
    and `findEntryIndex` alike (after review; `addPapers` used to merge into the last, and
    `findEntryIndex` let an earlier entry that merely shared a title beat the entry with the same id).
17. **Most advanced status wins** when several old-queue items merge into one record (to confirm; the
    plan only said an existing library status is kept).
18. **Back up before repairing** the library file (unreadable or duplicated-id entries), mirroring what
    the layouts file does, rather than silently dropping them.
20. **The original library file is never overwritten without a copy:** if the backup cannot be made, saving
    is held back (and retried) rather than proceeding; the load waits for the copy.
21. **"Repaired" includes lossy reads**, not just dropped entries: an unknown status, tags that do not fit
    or are not strings, a note that is not text, an unrecognised file shape, a newer `version`.
19. **Retries follow the backoff, not the edit rate:** while a write is failing, edits do not trigger
    attempts of their own; the scheduled retry writes the latest state.

## Not verifiable from this environment

- `cargo check --locked` / the Tauri shell: `webkit2gtk-4.1` is not installed, and nothing in `src-tauri`
  changes. The CI cargo job is therefore unrun.
- Live paper APIs: the sandbox proxy refuses `api.semanticscholar.org`, `api.openalex.org` and
  `export.arxiv.org`. No adapter is touched, so no live adapter check applies; the browser runs mock them.
- No `ANTHROPIC_API_KEY`, and no model code is touched.
- GitHub Actions: the workflow cannot be executed here.
- The desktop window: native dialogs, OS file drops, the Tauri store file itself (migration from the real
  `queue.json` / `annotations.json`) — covered by the manual checklist in the PR.

## Changes made after the code review

Ten findings; each was reproduced first (a failing unit test or a browser check) and fixed with a test
that fails without the fix, except where noted.

1. Removing a paper deleted its note → kept as an orphan (`removeEntry`), tooltip on the confirm button.
2. A pending edit for a removed paper was dropped silently → a toast says so.
3. A failed write was only `console.error`ed → toast once, automatic retry with backoff.
4. `addPapers` merged into the last of two same-titled entries while `findEntryIndex` picked the first →
   first wins in both.
5. `console.log` in `scripts/tauriParity.ts` against `CLAUDE.md` → `process.stdout.write`.
6. Unknown flags inside `migrated` were dropped → preserved.
7. A note keyed by an id that merged into another entry stayed an orphan → annotations now migrate first.
8. The Enter that confirms an IME candidate committed a half-typed tag → ignored while composing.
9. `loadLegacy` duplicated `loadLegacyWorkspace` → the latter delegates.
10. *Not changed:* "by-id scans are O(n) with key computation". By-id lookups compute no keys and cost
    62 µs worst case at 5000 entries; `idFor`, which does compute keys, is cached (found separately in
    self-review: 9.3 ms → 0.78 ms).

## Changes made after the second review

A second high-effort pass over the fixed branch found nine more. Reproduced first; unit tests and
mutation checks for each, and UI scenarios for the two that are user-visible.

1. `findEntryIndex` returned the *first* entry that matched by id **or** by title, so selecting the
   second of two same-title files resolved to the first and its notes and status landed there →
   an exact id match now wins (and `addPapers` uses the same rule).
2. Entries the loader could not read were dropped on the next write with no copy → the raw file is
   backed up first and the user is told how many entries were affected.
3. `addDocument`'s keep-both branch bypassed note adoption → it adopts like every other path.
4. A removed paper's note is matched by the paper's id only, so saving it again from another source does
   not bring it back. *Reproduced, not changed:* it is how the old annotations store behaved (notes were
   keyed by source id), a fix needs a multi-key orphan scheme with alias clean-up, and the note is
   not lost (it stays in `orphanNotes`). Documented in the README; listing and reattaching orphan notes
   is on the ideas list.
5. Two entries with one paper id would throw `each_key_duplicate` in the keyed views → folded into the
   first on load (notes joined, tags united, a status kept), counted as a repair and backed up.
6. Every edit made while the disk was failing triggered an attempt (150 attempts for 150 edits in 60 s,
   against about 5 for the backoff alone) → attempts follow the backoff only.
7. CI cancelled in-progress runs on `main` too → only for pull requests.
8. A new `npm audit` advisory would have stopped the job before the parity check → the audit is its own job.
9. Merged old-queue duplicates kept the oldest copy's status, so a finished paper could come back as
   "to read" → the most advanced status wins.

Observed, not part of this change: the dev build logs Svelte's `state_proxy_equality_mismatch` warning on
the file-import path. It appears identically on the pre-change commit (`b5ee275`), so it is left alone.

## Changes made after the third review

Seven more findings, all reproduced first. Six changed code; one is a dead-code removal.

1. The backup was fire-and-forget: if it failed the toast still said a copy was kept and the repaired
   library overwrote the original → the load waits for the copy; on failure the user is told plainly and
   saving is held back (retried with the usual backoff) until a copy exists.
2. A file whose top-level shape is not recognised (or is a newer `version`) loaded as empty with nothing
   reported → counted as a repair, so it is backed up first.
3. Entries read by dropping or cutting a known field (status from a newer build, more than 30 tags, a
   note that is not text) were not counted → `parseEntryChecked` reports lossy reads; harmless
   tidying (tag case, blank notes) does not trigger a backup.
4. Folding a duplicate-id entry dropped its `localFile`, stranding a blob → adopted when the first
   entry has none (if both have different files the backup keeps the other reference).
5. Old queue items the import could not use were skipped silently while the import was marked done →
   counted and reported once; the old file is untouched.
6. A second Annotations module showed a stale note and would overwrite it on its next save → the text
   follows the stored note unless an edit of its own is waiting to be saved.
7. `byStatus` was only used by tests → removed (see the API section).
