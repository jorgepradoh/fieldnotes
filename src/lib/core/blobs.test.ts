import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { deleteBlob, getBlob, listBlobIds, putBlob } from "./blobs";

const bytes = (...n: number[]): ArrayBuffer => new Uint8Array(n).buffer;

describe("blob store", () => {
  it("round-trips bytes and mime type", async () => {
    await putBlob("a", bytes(1, 2, 3), "application/pdf");
    const got = await getBlob("a");
    expect(got?.mime).toBe("application/pdf");
    expect(Array.from(new Uint8Array(got!.data))).toEqual([1, 2, 3]);
  });

  it("accepts a Blob and takes its type", async () => {
    await putBlob("b", new Blob(["# hello"], { type: "text/markdown" }));
    const got = await getBlob("b");
    expect(got?.mime).toBe("text/markdown");
    expect(new TextDecoder().decode(got!.data)).toBe("# hello");
  });

  it("overwrites an existing id", async () => {
    await putBlob("c", bytes(1));
    await putBlob("c", bytes(9, 9));
    expect(Array.from(new Uint8Array((await getBlob("c"))!.data))).toEqual([9, 9]);
  });

  it("returns null for a missing id", async () => {
    expect(await getBlob("nope")).toBeNull();
  });

  it("deletes, and deleting a missing id is fine", async () => {
    await putBlob("d", bytes(1));
    await deleteBlob("d");
    expect(await getBlob("d")).toBeNull();
    await expect(deleteBlob("d")).resolves.toBeUndefined();
  });

  it("lists stored ids", async () => {
    await putBlob("list-1", bytes(1));
    await putBlob("list-2", bytes(2));
    expect(await listBlobIds()).toEqual(expect.arrayContaining(["list-1", "list-2"]));
  });

  it("stores a large binary intact", async () => {
    const big = new Uint8Array(5 * 1024 * 1024).map((_, i) => i % 251);
    await putBlob("big", big.buffer);
    const got = new Uint8Array((await getBlob("big"))!.data);
    expect(got.length).toBe(big.length);
    expect(got[123_456]).toBe(big[123_456]);
  });
});
