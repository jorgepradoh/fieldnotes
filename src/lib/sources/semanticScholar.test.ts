import { describe, expect, it } from "vitest";
import { mapS2Paper, type S2Paper } from "./semanticScholar";

const full: S2Paper = {
  paperId: "c10075b3",
  title: "High-Resolution Image Synthesis with Latent Diffusion Models",
  abstract: "By decomposing the image formation process…",
  year: 2021,
  venue: "Computer Vision and Pattern Recognition",
  citationCount: 25166,
  url: "https://www.semanticscholar.org/paper/c10075b3",
  authors: [{ name: "Robin Rombach" }, { name: "A. Blattmann" }],
  tldr: { text: "These latent diffusion models achieve new state of the art…" },
  externalIds: { ArXiv: "2112.10752", DOI: "10.1109/CVPR52688.2022.01042", CorpusId: 245335280 },
  openAccessPdf: { url: "https://arxiv.org/pdf/2112.10752" },
};

describe("mapS2Paper", () => {
  it("maps a fully-populated paper", () => {
    const paper = mapS2Paper(full);
    expect(paper).toEqual({
      id: "s2:c10075b3",
      source: "semantic-scholar",
      title: "High-Resolution Image Synthesis with Latent Diffusion Models",
      authors: ["Robin Rombach", "A. Blattmann"],
      year: 2021,
      venue: "Computer Vision and Pattern Recognition",
      abstract: "By decomposing the image formation process…",
      tldr: "These latent diffusion models achieve new state of the art…",
      citationCount: 25166,
      url: "https://www.semanticscholar.org/paper/c10075b3",
      pdfUrl: "https://arxiv.org/pdf/2112.10752",
      doi: "10.1109/CVPR52688.2022.01042",
      arxivId: "2112.10752",
    });
  });

  it("nulls every optional field on a sparse paper", () => {
    const paper = mapS2Paper({ paperId: "x", title: "Sparse" });
    expect(paper).toEqual({
      id: "s2:x",
      source: "semantic-scholar",
      title: "Sparse",
      authors: [],
      year: null,
      venue: null,
      abstract: null,
      tldr: null,
      citationCount: null,
      url: null,
      pdfUrl: null,
      doi: null,
      arxivId: null,
    });
  });

  it("treats empty venue as null and stringifies numeric ids", () => {
    const paper = mapS2Paper({
      paperId: "x",
      title: "T",
      venue: "",
      externalIds: { ArXiv: 2112.10752 },
    });
    expect(paper.venue).toBeNull();
    expect(paper.arxivId).toBe("2112.10752");
  });
});
