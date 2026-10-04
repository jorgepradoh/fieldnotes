# Ideas parking lot

Features we like but have not committed to. Each entry says what it is, why it
fits fieldnotes, and the cheapest first step. Move an idea into the README
roadmap when someone picks it up.

## Obsidian integration: notes, graph and diagrams

**The idea.** fieldnotes finds and reads papers; Obsidian is where many people
keep their long-term notes and see how ideas connect. Let the two share a vault
so a literature search ends up as linked notes, and let paper relations be
visualised — in fieldnotes itself and in Obsidian's graph view.

**Why it fits.** Everything fieldnotes produces is already plain markdown or
simple JSON (AI briefs, notes, BibTeX citekeys, layouts), the app is
local-first, and a vault is just a folder of `.md` files — no API needed.

### Possible shapes, cheapest first

1. **One-way export to a vault.** "Export to vault…" writes one note per library
   paper: YAML frontmatter (`title`, `authors`, `year`, `doi`, `arxiv`,
   `citekey`, `tags`), the abstract and TL;DR as the body, `[[wikilinks]]` for
   authors and for papers it cites. Briefs export as their own note linking to
   every paper they cite. Frontmatter keys chosen to be Dataview-friendly.
2. **Deep links.** `obsidian://open?vault=…&file=…` / `obsidian://new?…` buttons
   so a paper in the Reader can jump to (or create) its note.
3. **Vault folder as the Notes backend.** The Notes module reads and writes
   `.md` files in a chosen vault folder (folder picked through the dialog so
   the fs scope stays narrow), with a file watcher for two-way sync and a
   backlinks pane for `[[links]]`.
4. **Paper-relation graph.** Pull `references` / `citations` from Semantic
   Scholar and OpenAlex and show them in a graph module (force-directed on a
   canvas, nodes sized by citations, coloured by year or cluster). Export the
   same edges as `[[links]]` so Obsidian's graph view shows the relations, or
   as a [JSON Canvas](https://jsoncanvas.org) (`.canvas`) file for a curated map
   of selected papers.
5. **Diagrams.** Ask the synthesis module to emit Mermaid (`graph TD` concept
   maps, `timeline` of how the field developed). Render in-app (mermaid.js,
   lazy-loaded) and keep it as a fenced ```` ```mermaid ```` block, which
   Obsidian renders natively.

### Open questions

- Permission model: how does the Tauri fs scope get the vault path without
  granting broad disk access? (Folder picked via the dialog plugin is the
  likely answer.)
- Conflict handling when a note is edited in both apps.
- Stable note identity: BibTeX citekeys for imported entries, DOI / arXiv id
  otherwise.
- Interop with existing plugins people already use (Zotero Integration,
  Citations, Dataview, Juggl, Breadcrumbs).

### Builds on

The BibTeX importer and local library (citekeys, metadata), AI briefs
(markdown with `[n]` citations), and layouts (a vault-linked layout preset).
