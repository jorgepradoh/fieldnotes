import { describe, expect, it } from "vitest";
import { bibtexToPapers, cleanTex, entryToPaper, parseAuthors, parseBibtex } from "./bibtex";

describe("parseBibtex: structure", () => {
  it("parses braced and quoted values, any case, with a trailing comma", () => {
    const { entries, problems } = parseBibtex(`
      @ARTICLE{knuth84,
        AUTHOR = {Donald E. Knuth},
        title  = "Literate Programming",
        year   = 1984,
      }`);
    expect(problems).toEqual([]);
    expect(entries).toEqual([
      { type: "article", key: "knuth84", fields: { author: "Donald E. Knuth", title: "Literate Programming", year: "1984" } },
    ]);
  });

  it("keeps nested braces and escaped braces inside a value", () => {
    const [e] = parseBibtex(String.raw`@misc{k, title = {The {TCP/IP} {Illustrated: {Vol} 1} \{raw\}}}`).entries;
    expect(e.fields.title).toBe(String.raw`The {TCP/IP} {Illustrated: {Vol} 1} \{raw\}`);
  });

  it("lets quotes appear inside braces within a quoted value", () => {
    const [e] = parseBibtex('@misc{k, title = "A {\\"o} and {"} quote"}').entries;
    expect(e.fields.title).toBe('A {\\"o} and {"} quote');
  });

  it("expands @string macros, the standard month macros and # concatenation", () => {
    const { entries } = parseBibtex(`
      @string{ieee = "IEEE Transactions on "}
      @string(pami = {Pattern Analysis})
      @article{k, journal = ieee # pami, month = jan, year = 2020, note = "see " # {note} # " twice"}`);
    expect(entries[0].fields).toMatchObject({ journal: "IEEE Transactions on Pattern Analysis", month: "January", year: "2020", note: "see note twice" });
  });

  it("leaves unknown macros as their own text", () => {
    expect(parseBibtex("@misc{k, publisher = acm}").entries[0].fields.publisher).toBe("acm");
  });

  it("accepts parenthesised entries", () => {
    const { entries } = parseBibtex('@book(k, title = "Parens", year = 1999)');
    expect(entries[0]).toMatchObject({ type: "book", key: "k", fields: { title: "Parens", year: "1999" } });
  });

  it("ignores @comment, @preamble, prose and bare @ signs", () => {
    const { entries, problems } = parseBibtex(`
      This file was exported by hand. Contact me@example.org for more.
      @comment{ @article{ghost, title={Not real} } }
      @preamble{ "\\newcommand{\\noop}[1]{}" }
      @article{real, title = {Real}}
      @ trailing`);
    expect(entries.map((e) => e.key)).toEqual(["real"]);
    expect(problems).toEqual([]);
  });

  it("handles keys with unusual characters", () => {
    expect(parseBibtex("@misc{doe:2020/a-b_c, title={t}}").entries[0].key).toBe("doe:2020/a-b_c");
  });

  it("parses many entries in order", () => {
    const text = Array.from({ length: 5 }, (_, i) => `@misc{k${i}, title={T${i}}}`).join("\n");
    expect(parseBibtex(text).entries.map((e) => e.key)).toEqual(["k0", "k1", "k2", "k3", "k4"]);
  });
});

describe("parseBibtex: damaged input", () => {
  it("keeps what it can from an entry that is never closed", () => {
    const { entries, problems } = parseBibtex("@article{k, title = {Kept}, year = 2020");
    expect(entries[0].fields).toMatchObject({ title: "Kept", year: "2020" });
    expect(problems[0]).toMatch(/not closed/);
  });

  it("recovers from a malformed field and carries on with the next one", () => {
    const { entries, problems } = parseBibtex("@article{k, title {no equals}, year = 2020, author = {A B}}");
    expect(entries[0].fields).toMatchObject({ year: "2020", author: "A B" });
    expect(problems.length).toBeGreaterThan(0);
  });

  it("recovers from a damaged entry without losing the one after it", () => {
    const { entries } = parseBibtex("@article{bad, title = }\n@article{good, title = {Fine}}");
    expect(entries.find((e) => e.key === "good")?.fields.title).toBe("Fine");
  });

  it("reports empty entries with a line number", () => {
    const { entries, problems } = parseBibtex("\n\n@article{empty}\n");
    expect(entries).toEqual([]);
    expect(problems[0]).toMatch(/Line 3.*no fields/);
  });

  it("copes with empty and non-BibTeX input", () => {
    expect(parseBibtex("")).toEqual({ entries: [], problems: [] });
    expect(parseBibtex("just some text, no entries").entries).toEqual([]);
    expect(parseBibtex("@").entries).toEqual([]);
    expect(parseBibtex("@article").entries).toEqual([]);
  });

  it("does not hang on pathological unbalanced input", () => {
    const start = Date.now();
    parseBibtex("@article{k, title = {" + "{".repeat(10_000));
    parseBibtex("@article{k, title = \"" + "a".repeat(100_000));
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("is fast on a large library (no quadratic line counting)", () => {
    const one = "@article{KEY, title = {Some title here}, author = {A B and C D}, year = 2020, journal = {J}, abstract = {" + "word ".repeat(100) + "}}\n";
    const text = Array.from({ length: 5000 }, (_, i) => one.replace("KEY", `k${i}`)).join("\n");
    const start = Date.now();
    const { entries } = parseBibtex(text);
    expect(entries).toHaveLength(5000);
    expect(Date.now() - start).toBeLessThan(1500);
  });
});

describe("cleanTex", () => {
  it.each([
    [String.raw`M{\"u}ller`, "Müller"],
    [String.raw`Gonz\'{a}lez`, "González"],
    [String.raw`Gonz\'alez`, "González"],
    [String.raw`{\'E}cole`, "École"],
    [String.raw`Fran\c{c}ois`, "François"],
    [String.raw`Fran\c cois`, "François"],
    [String.raw`Dvo\v{r}\'ak`, "Dvořák"],
    [String.raw`Erd\H{o}s`, "Erdős"],
    [String.raw`\'{\i}`, "í"],
    [String.raw`Stra{\ss}e`, "Straße"],
    [String.raw`Bj{\o}rn \AA{}ke`, "Bjørn Åke"],
    [String.raw`Kr\'{o}l \& Sons`, "Król & Sons"],
    [String.raw`100\% sure\_ \$5 \#1`, "100% sure_ $5 #1"],
    ["Vol.~1, pp.~10--20 --- done", "Vol. 1, pp. 10–20 — done"],
    [String.raw`\emph{Deep} \textbf{learning}`, "Deep learning"],
    [String.raw`Learning $k$-means`, "Learning k-means"],
    ["{GPU} and {NLP}: {A} Survey", "GPU and NLP: A Survey"],
    ["  lots \n of   space  ", "lots of space"],
    [String.raw`an \unknowncommand here`, "an here"],
  ])("%s → %s", (input, expected) => {
    expect(cleanTex(input)).toBe(expected);
  });

  it("returns NFC-normalised text", () => {
    expect(cleanTex(String.raw`\'e`)).toBe("é");
    expect(cleanTex(String.raw`\'e`).length).toBe(1);
  });
});

describe("parseAuthors", () => {
  it("handles 'Last, First' and 'First Last'", () => {
    expect(parseAuthors("Knuth, Donald E. and Lamport, Leslie")).toEqual(["Donald E. Knuth", "Leslie Lamport"]);
    expect(parseAuthors("Donald E. Knuth and Leslie Lamport")).toEqual(["Donald E. Knuth", "Leslie Lamport"]);
  });

  it("handles Jr. forms and drops 'others'", () => {
    expect(parseAuthors("Smith, Jr., John and others")).toEqual(["John Smith, Jr."]);
  });

  it("keeps braced corporate authors whole, including an 'and' inside", () => {
    expect(parseAuthors("{World Health Organization} and Doe, Jane")).toEqual(["World Health Organization", "Jane Doe"]);
    expect(parseAuthors("{Smith and Sons, Inc.}")).toEqual(["Smith and Sons, Inc."]);
  });

  it("is case-insensitive about AND and tolerates newlines", () => {
    expect(parseAuthors("A One AND\n  B Two\n and C Three")).toEqual(["A One", "B Two", "C Three"]);
  });

  it("cleans accents in names", () => {
    expect(parseAuthors(String.raw`M{\"u}ller, J{\"o}rg`)).toEqual(["Jörg Müller"]);
  });

  it("returns [] for nothing", () => {
    expect(parseAuthors(undefined)).toEqual([]);
    expect(parseAuthors("")).toEqual([]);
  });
});

describe("entryToPaper", () => {
  const googleScholar = `@article{vaswani2017attention,
    title={Attention is all you need},
    author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
    journal={Advances in neural information processing systems},
    volume={30},
    year={2017}
  }`;

  it("maps a Google-Scholar-style article", () => {
    const { papers } = bibtexToPapers(googleScholar, () => "local:1");
    expect(papers[0]).toEqual({
      id: "local:1",
      source: "bibtex",
      title: "Attention is all you need",
      authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
      year: 2017,
      venue: "Advances in neural information processing systems",
      abstract: null,
      tldr: null,
      citationCount: null,
      url: null,
      pdfUrl: null,
      doi: null,
      arxivId: null,
      citekey: "vaswani2017attention",
    });
  });

  it("maps an arXiv-exported @misc and gives it an open PDF", () => {
    const { papers } = bibtexToPapers(
      `@misc{v2023, title={Attention Is All You Need}, author={Vaswani, Ashish}, year={2023}, eprint={1706.03762}, archivePrefix={arXiv}, primaryClass={cs.CL}}`,
    );
    expect(papers[0]).toMatchObject({
      arxivId: "1706.03762",
      pdfUrl: "https://arxiv.org/pdf/1706.03762",
      url: "https://arxiv.org/abs/1706.03762",
      venue: "arXiv",
    });
  });

  it("finds an arXiv id in Google Scholar's 'arXiv preprint' journal line", () => {
    const { papers } = bibtexToPapers(`@article{k, title={t}, journal={arXiv preprint arXiv:2005.14165}, year={2020}}`);
    expect(papers[0].arxivId).toBe("2005.14165");
    expect(papers[0].pdfUrl).toBe("https://arxiv.org/pdf/2005.14165");
  });

  it("finds the arXiv id from an arXiv DataCite DOI and from a url", () => {
    expect(bibtexToPapers(`@misc{k, title={t}, doi={10.48550/arXiv.1706.03762}}`).papers[0].arxivId).toBe("1706.03762");
    expect(bibtexToPapers(`@misc{k, title={t}, url={https://arxiv.org/abs/2401.01234v2}}`).papers[0].arxivId).toBe("2401.01234");
  });

  it("does not mistake a non-arXiv eprint for an arXiv id", () => {
    const { papers } = bibtexToPapers(`@article{k, title={t}, eprint={12345678}, archivePrefix={PubMed}}`);
    expect(papers[0].arxivId).toBeNull();
  });

  it("normalises DOIs given as URLs or with prefixes and links to doi.org", () => {
    expect(bibtexToPapers(`@article{k, title={t}, doi={https://doi.org/10.1109/CVPR.2022.01042}}`).papers[0]).toMatchObject({
      doi: "10.1109/cvpr.2022.01042",
      url: "https://doi.org/10.1109/cvpr.2022.01042",
    });
    expect(bibtexToPapers(`@article{k, title={t}, url={https://dx.doi.org/10.1000/xyz123}}`).papers[0].doi).toBe("10.1000/xyz123");
  });

  it("keeps ~ and -- in url, doi and eprint: they are verbatim fields, not TeX", () => {
    const [p] = bibtexToPapers("@misc{k, title={t}, url={http://x.org/~u/p--q}}").papers;
    expect(p.url).toBe("http://x.org/~u/p--q");
    expect(bibtexToPapers("@misc{k, title={t}, doi={10.1000/a~b--c}}").papers[0].doi).toBe("10.1000/a~b--c");
  });

  it("removes BibTeX escapes, braces and line-wrap whitespace from urls", () => {
    const text = String.raw`@misc{k, title={t}, url={http://x.org/\~user/a\_b\%20c
      /{page}}}`;
    expect(bibtexToPapers(text).papers[0].url).toBe("http://x.org/~user/a_b%20c/page");
  });

  it("still cleans TeX in text fields", () => {
    expect(bibtexToPapers("@misc{k, title={Vol.~1 -- done}}").papers[0].title).toBe("Vol. 1 – done");
  });

  it("prefers the explicit url field and ignores non-http urls", () => {
    expect(bibtexToPapers(`@article{k, title={t}, doi={10.1000/a}, url={https://example.org/p}}`).papers[0].url).toBe("https://example.org/p");
    expect(bibtexToPapers(`@article{k, title={t}, doi={10.1000/a}, url={javascript:alert(1)}}`).papers[0].url).toBe("https://doi.org/10.1000/a");
  });

  it("falls back across venue fields and across date fields", () => {
    expect(bibtexToPapers(`@inproceedings{k, title={t}, booktitle={Proc. of X}}`).papers[0].venue).toBe("Proc. of X");
    expect(bibtexToPapers(`@article{k, title={t}, journaltitle={J. Biblatex}, date={2021-03-04}}`).papers[0]).toMatchObject({ venue: "J. Biblatex", year: 2021 });
    expect(bibtexToPapers(`@phdthesis{k, title={t}, school={MIT}, year={n.d. 1999?}}`).papers[0]).toMatchObject({ venue: "MIT", year: 1999 });
  });

  it("uses editors when there are no authors, and the key when there is no title", () => {
    expect(bibtexToPapers(`@book{k, editor={Doe, Jane}, title={Handbook}}`).papers[0].authors).toEqual(["Jane Doe"]);
    expect(bibtexToPapers(`@misc{lonelykey, year={2000}}`).papers[0].title).toBe("lonelykey");
  });

  it("cleans TeX in the abstract and title", () => {
    const { papers } = bibtexToPapers(String.raw`@article{k, title={On {B}ayesian {\"U}ber-models}, abstract={We show that $O(n)$ suffices \textit{in practice}.}}`);
    expect(papers[0].title).toBe("On Bayesian Über-models");
    expect(papers[0].abstract).toBe("We show that O(n) suffices in practice.");
  });

  it("gives every entry a distinct id", () => {
    let n = 0;
    const { papers } = bibtexToPapers(`@misc{a, title={A}} @misc{b, title={B}}`, () => `local:${++n}`);
    expect(papers.map((p) => p.id)).toEqual(["local:1", "local:2"]);
  });

  it("entryToPaper is usable directly", () => {
    expect(entryToPaper({ type: "misc", key: "k", fields: { title: "T" } }, "x").title).toBe("T");
  });
});
