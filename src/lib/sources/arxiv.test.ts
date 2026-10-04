// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { arxiv, buildArxivQuery, parseArxivFeed } from "./arxiv";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title>ArXiv Query: search_query=all:attention</title>
  <opensearch:totalResults>1234</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>2</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All
  You Need</title>
    <summary>  The dominant sequence transduction models &amp; their
 successors use &lt;recurrence&gt;.
 </summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <arxiv:doi>10.48550/arXiv.1706.03762</arxiv:doi>
    <arxiv:journal_ref>Advances in Neural Information Processing Systems 30 (2017)</arxiv:journal_ref>
    <link href="http://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
    <arxiv:primary_category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/hep-th/9901001v1</id>
    <published>1999-01-04T10:00:00Z</published>
    <title>An old-style identifier paper</title>
    <summary>Short.</summary>
    <author><name>J. Maldacena</name></author>
    <arxiv:primary_category term="hep-th" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

const ERROR_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format_for_1234</id>
    <title>Error</title>
    <summary>incorrect id format for 1234</summary>
  </entry>
</feed>`;

describe("buildArxivQuery", () => {
  it("ANDs words with the all: prefix", () => {
    expect(buildArxivQuery("graph neural")).toBe("(all:graph AND all:neural)");
    expect(buildArxivQuery("transformers")).toBe("all:transformers");
  });

  it("keeps quoted phrases together and quotes hyphenated words", () => {
    expect(buildArxivQuery('"state space" self-supervised')).toBe(
      '(all:"state space" AND all:"self-supervised")',
    );
  });

  it("honours upper-case OR / NOT", () => {
    expect(buildArxivQuery("cnn OR rnn")).toBe("(all:cnn OR all:rnn)");
    expect(buildArxivQuery("llm NOT vision")).toBe("(all:llm ANDNOT all:vision)");
  });

  it("strips characters that have meaning in the grammar", () => {
    expect(buildArxivQuery("a:b (c) d*")).toBe('(all:"a b" AND all:c AND all:d)');
  });

  it("ignores stray operators and empty input", () => {
    expect(buildArxivQuery("")).toBe("");
    expect(buildArxivQuery("   ")).toBe("");
    expect(buildArxivQuery("OR")).toBe("");
    expect(buildArxivQuery("NOT x")).toBe("all:x");
  });

  it("adds a submittedDate range for year filters", () => {
    expect(buildArxivQuery("x", { yearFrom: 2020, yearTo: 2022 })).toBe(
      "all:x AND submittedDate:[202001010000 TO 202212312359]",
    );
    expect(buildArxivQuery("x", { yearFrom: 2020 })).toMatch(/\[202001010000 TO \d{4}12312359\]$/);
    expect(buildArxivQuery("x", { yearTo: 2000 })).toContain("[199101010000 TO 200012312359]");
  });
});

describe("parseArxivFeed", () => {
  const parsed = parseArxivFeed(FEED);

  it("reads paging info", () => {
    expect(parsed.total).toBe(1234);
    expect(parsed.start).toBe(0);
    expect(parsed.papers).toHaveLength(2);
  });

  it("maps a full entry", () => {
    expect(parsed.papers[0]).toEqual({
      id: "arxiv:1706.03762",
      source: "arxiv",
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      venue: "Advances in Neural Information Processing Systems 30 (2017)",
      abstract: "The dominant sequence transduction models & their successors use <recurrence>.",
      tldr: null,
      citationCount: null,
      url: "https://arxiv.org/abs/1706.03762",
      pdfUrl: "https://arxiv.org/pdf/1706.03762",
      doi: "10.48550/arXiv.1706.03762",
      arxivId: "1706.03762",
    });
  });

  it("handles old-style ids and falls back to the category as venue", () => {
    expect(parsed.papers[1]).toMatchObject({
      id: "arxiv:hep-th/9901001",
      arxivId: "hep-th/9901001",
      year: 1999,
      venue: "arXiv · hep-th",
      doi: null,
      pdfUrl: "https://arxiv.org/pdf/hep-th/9901001",
    });
  });

  it("turns arXiv's in-band error entry into an error", () => {
    expect(() => parseArxivFeed(ERROR_FEED)).toThrow(/incorrect id format/);
  });

  it("rejects malformed XML", () => {
    expect(() => parseArxivFeed("<feed><entry></feed>")).toThrow();
  });

  it("copes with an empty feed", () => {
    const empty = parseArxivFeed(
      '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>0</opensearch:totalResults></feed>',
    );
    expect(empty).toEqual({ papers: [], total: 0, start: 0 });
  });
});

describe("arxiv.search", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(body: string, status = 200) {
    const fn = vi.fn(async (..._args: unknown[]) => new Response(body, { status }));
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("builds the request and computes the next offset", async () => {
    const fn = stub(FEED);
    const result = await arxiv.search({ query: "attention", limit: 2, offset: 0, sort: "newest" });
    const url = new URL(String(fn.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://export.arxiv.org/api/query");
    expect(url.searchParams.get("search_query")).toBe("all:attention");
    expect(url.searchParams.get("max_results")).toBe("2");
    expect(url.searchParams.get("sortBy")).toBe("submittedDate");
    expect(result.nextOffset).toBe(2);
    expect(result.total).toBe(1234);
  });

  it("falls back to relevance for citation sort", async () => {
    const fn = stub(FEED);
    await arxiv.search({ query: "x", sort: "citations" });
    expect(new URL(String(fn.mock.calls[0][0])).searchParams.get("sortBy")).toBe("relevance");
  });

  it("does not hit the network for an empty query", async () => {
    const fn = stub(FEED);
    const result = await arxiv.search({ query: "  " });
    expect(fn).not.toHaveBeenCalled();
    expect(result.papers).toEqual([]);
  });

  it("reports the last page as exhausted", async () => {
    stub(FEED.replace("<opensearch:totalResults>1234", "<opensearch:totalResults>2"));
    expect((await arxiv.search({ query: "x" })).nextOffset).toBeNull();
  });

  it("reports HTTP failures", async () => {
    stub("nope", 500);
    await expect(arxiv.search({ query: "x" })).rejects.toThrow(/failed \(500\)/);
  });

  it("explains a rate limit", async () => {
    stub("slow down", 429);
    // Default Retry-After is absent → retries use backoff; use fake timers to skip it.
    vi.useFakeTimers();
    const pending = arxiv.search({ query: "x" }).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    expect(((await pending) as Error).message).toMatch(/Rate limited by arXiv/);
    vi.useRealTimers();
  });
});
