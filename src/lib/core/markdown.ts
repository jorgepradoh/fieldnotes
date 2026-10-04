/**
 * Markdown → HTML for content we do not fully trust: LLM output (which can be
 * steered by whatever is in a paper abstract) and markdown files dropped in
 * from disk. The result is safe to feed to `{@html}`:
 *
 *  - raw HTML is shown as literal text, never interpreted;
 *  - images are not loaded (a remote image URL is a classic exfiltration
 *    channel for prompt-injected output) — the alt text is shown instead;
 *  - links keep only http(s)/mailto/#fragment targets, so `javascript:` and
 *    `data:` URLs are dropped.
 *
 * The user's own Notes module keeps using plain `marked`; that is their text.
 */
import { Marked, type Tokens } from "marked";

const SAFE_HREF = /^(https?:\/\/|mailto:|#)/i;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const parser = new Marked({ gfm: true, async: false });

parser.use({
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    image({ text }: Tokens.Image): string {
      return escapeHtml(text);
    },
    link({ href, title, tokens }: Tokens.Link): string {
      const inner = this.parser.parseInline(tokens);
      if (!SAFE_HREF.test(href.trim())) return inner;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href.trim())}"${titleAttr} target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
  },
});

export function renderSafeMarkdown(source: string): string {
  return parser.parse(source, { async: false });
}

/**
 * Turn `[3]` / `[3, 5]` style citation markers in already-safe HTML into
 * `<button data-cite>` elements. Only touches text outside tags and code, and
 * only emits digits, so it cannot introduce markup from the input.
 */
export function linkCitations(html: string, maxIndex: number): string {
  return html
    .split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>|<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith("<")) return part;
      return part.replace(/\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)\]/g, (whole, inner: string) => {
        const nums = inner.split(/\s*[,–-]\s*/).map(Number);
        if (nums.some((n) => n < 1 || n > maxIndex)) return whole;
        // "[2–4]" is a range, "[2, 4]" a list; only the endpoints/list items link.
        const isRange = /[–-]/.test(inner);
        const items = isRange ? [nums[0], nums[nums.length - 1]] : nums;
        const rendered = items.map(
          (n) => `<button type="button" class="cite" data-cite="${n}">${n}</button>`,
        );
        return `[${rendered.join(isRange ? "–" : ", ")}]`;
      });
    })
    .join("");
}
