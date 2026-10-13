import { describe, expect, it } from "vitest";
import type { Paper } from "../sources/types";
import type { LibraryEntry, PaperStatus } from "./model";
import { ADVANCE_LABEL, STATUS_LABEL, nextStatus, queueColumns } from "./queue";

const entry = (id: string, over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  paper: { id, source: "x", title: id, authors: [], year: null, venue: null, abstract: null, tldr: null, citationCount: null, url: null, pdfUrl: null, doi: null, arxivId: null } as Paper,
  addedAt: 100,
  ...over,
});

describe("nextStatus", () => {
  it("moves along the three statuses and then off the queue", () => {
    expect(nextStatus("to-read")).toBe("reading");
    expect(nextStatus("reading")).toBe("done");
    expect(nextStatus("done")).toBeNull();
  });
});

describe("labels", () => {
  it("has a column name and a button label for every status", () => {
    for (const s of ["to-read", "reading", "done"] as PaperStatus[]) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(ADVANCE_LABEL[s]).toBeTruthy();
    }
    expect(ADVANCE_LABEL.done).toBe("Remove");
  });
});

describe("queueColumns", () => {
  it("sorts papers into their column, most recently moved first", () => {
    const columns = queueColumns([
      entry("old", { status: "to-read", statusAt: 10 }),
      entry("new", { status: "to-read", statusAt: 30 }),
      entry("mid", { status: "to-read", statusAt: 20 }),
      entry("r", { status: "reading", statusAt: 5 }),
      entry("d", { status: "done", statusAt: 5 }),
    ]);
    expect(columns["to-read"].map((e) => e.paper.id)).toEqual(["new", "mid", "old"]);
    expect(columns.reading.map((e) => e.paper.id)).toEqual(["r"]);
    expect(columns.done.map((e) => e.paper.id)).toEqual(["d"]);
  });

  it("leaves out papers that are not queued", () => {
    const columns = queueColumns([entry("a"), entry("b", { status: "reading", statusAt: 1 })]);
    expect(columns["to-read"]).toEqual([]);
    expect(columns.reading.map((e) => e.paper.id)).toEqual(["b"]);
  });

  it("falls back to when the paper was added if a status has no time, and keeps library order on ties", () => {
    const columns = queueColumns([
      entry("first", { status: "done", addedAt: 50 }),
      entry("second", { status: "done", addedAt: 50 }),
      entry("later", { status: "done", addedAt: 90 }),
    ]);
    expect(columns.done.map((e) => e.paper.id)).toEqual(["later", "first", "second"]);
  });

  it("does not reorder or modify its input", () => {
    const input = [entry("a", { status: "done", statusAt: 1 }), entry("b", { status: "done", statusAt: 2 })];
    queueColumns(input);
    expect(input.map((e) => e.paper.id)).toEqual(["a", "b"]);
  });

  it("is empty for an empty library", () => {
    expect(queueColumns([])).toEqual({ "to-read": [], reading: [], done: [] });
  });
});
