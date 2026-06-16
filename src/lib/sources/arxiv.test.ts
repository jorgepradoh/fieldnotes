// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseAtomXml } from "./arxiv";

const SINGLE_ENTRY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom"
      xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults>248741</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>1</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2209.15001v3</id>
    <published>2022-09-29T17:57:08Z</published>
    <title>  Dilated Neighborhood Attention Transformer  </title>
    <summary>  Transformers are quickly becoming one of the most heavily applied deep learning
    architectures across modalities.  </summary>
    <author><name>Ali Hassani</name></author>
    <author><name>Humphrey Shi</name></author>
    <arxiv:primary_category term="cs.CV" scheme="http://arxiv.org/schemas/atom"/>
    <link href="https://arxiv.org/abs/2209.15001v3" rel="alternate" type="text/html"/>
    <link title="pdf" href="https://arxiv.org/pdf/2209.15001v3" rel="related" type="application/pdf"/>
    <arxiv:doi>10.1234/example.doi</arxiv:doi>
  </entry>
</feed>`;

const ERROR_ENTRY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format</id>
    <title>Error</title>
    <summary>incorrect id format for id_list parameter</summary>
  </entry>
</feed>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults>0</opensearch:totalResults>
</feed>`;

describe("parseAtomXml", () => {
  it("maps a full entry", () => {
    const result = parseAtomXml(SINGLE_ENTRY, 0, 1);
    expect(result.total).toBe(248741);
    expect(result.offset).toBe(0);
    expect(result.papers).toHaveLength(1);

    const p = result.papers[0];
    expect(p.id).toBe("arxiv:2209.15001");
    expect(p.source).toBe("arxiv");
    expect(p.title).toBe("Dilated Neighborhood Attention Transformer");
    expect(p.authors).toEqual(["Ali Hassani", "Humphrey Shi"]);
    expect(p.year).toBe(2022);
    expect(p.venue).toBe("cs.CV");
    expect(p.url).toBe("https://arxiv.org/abs/2209.15001v3");
    expect(p.pdfUrl).toBe("https://arxiv.org/pdf/2209.15001v3");
    expect(p.doi).toBe("10.1234/example.doi");
    expect(p.arxivId).toBe("2209.15001");
    expect(p.tldr).toBeNull();
    expect(p.citationCount).toBeNull();
  });

  it("collapses whitespace in title and abstract", () => {
    const result = parseAtomXml(SINGLE_ENTRY, 0, 1);
    expect(result.papers[0].abstract).toMatch(/^Transformers are quickly/);
    expect(result.papers[0].abstract).not.toMatch(/\n/);
  });

  it("strips version suffix from arxivId", () => {
    expect(parseAtomXml(SINGLE_ENTRY, 0, 1).papers[0].arxivId).toBe("2209.15001");
  });

  it("filters out error sentinel entries", () => {
    const result = parseAtomXml(ERROR_ENTRY, 0, 20);
    expect(result.papers).toHaveLength(0);
  });

  it("returns empty papers and zero total for empty feed", () => {
    const result = parseAtomXml(EMPTY_FEED, 0, 20);
    expect(result.total).toBe(0);
    expect(result.papers).toHaveLength(0);
    expect(result.nextOffset).toBeNull();
  });

  it("sets nextOffset when more results exist", () => {
    const result = parseAtomXml(SINGLE_ENTRY, 0, 1);
    expect(result.nextOffset).toBe(1);
  });

  it("nulls nextOffset on last page", () => {
    const result = parseAtomXml(SINGLE_ENTRY, 248740, 1);
    expect(result.nextOffset).toBeNull();
  });
});
