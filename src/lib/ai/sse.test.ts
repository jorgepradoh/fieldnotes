import { describe, expect, it } from "vitest";
import { parseSse, type SseEvent } from "./sse";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const e of parseSse(body)) out.push(e);
  return out;
}

describe("parseSse", () => {
  it("parses named events", async () => {
    const events = await collect(streamOf("event: ping\ndata: {\"a\":1}\n\nevent: done\ndata: x\n\n"));
    expect(events).toEqual([
      { event: "ping", data: '{"a":1}' },
      { event: "done", data: "x" },
    ]);
  });

  it("parses data-only events (OpenAI style) with a null event name", async () => {
    expect(await collect(streamOf("data: hello\n\ndata: [DONE]\n\n"))).toEqual([
      { event: null, data: "hello" },
      { event: null, data: "[DONE]" },
    ]);
  });

  it("joins multi-line data with newlines", async () => {
    expect((await collect(streamOf("data: a\ndata: b\n\n")))[0].data).toBe("a\nb");
  });

  it("handles events split at arbitrary byte boundaries", async () => {
    const text = "event: x\ndata: first\n\ndata: second\n\n";
    for (let cut = 1; cut < text.length; cut++) {
      const events = await collect(streamOf(text.slice(0, cut), text.slice(cut)));
      expect(events.map((e) => e.data), `cut at ${cut}`).toEqual(["first", "second"]);
    }
  });

  it("handles CRLF, including a CRLF split across chunks", async () => {
    expect((await collect(streamOf("data: a\r\n\r\ndata: b\r", "\n\r\n"))).map((e) => e.data)).toEqual(["a", "b"]);
    expect((await collect(streamOf("data: a\r\rdata: b\r\r"))).map((e) => e.data)).toEqual(["a", "b"]);
  });

  it("ignores comments and unknown fields, strips one leading space only", async () => {
    const events = await collect(streamOf(": keep-alive\nid: 7\nretry: 5\ndata:  two spaces\n\n"));
    expect(events).toEqual([{ event: null, data: " two spaces" }]);
  });

  it("delivers a final event with no trailing blank line", async () => {
    expect(await collect(streamOf("data: last"))).toEqual([{ event: null, data: "last" }]);
  });

  it("does not split multi-byte characters across chunks", async () => {
    const bytes = new TextEncoder().encode("data: héllo → ✓\n\n");
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        // Cut in the middle of the 'é' (2 bytes) and of '→' (3 bytes).
        c.enqueue(bytes.slice(0, 8));
        c.enqueue(bytes.slice(8, 15));
        c.enqueue(bytes.slice(15));
        c.close();
      },
    });
    expect((await collect(body))[0].data).toBe("héllo → ✓");
  });

  it("skips blank-line runs without emitting empty events", async () => {
    expect(await collect(streamOf("\n\n\ndata: x\n\n\n\n"))).toEqual([{ event: null, data: "x" }]);
  });

  it("cancels the underlying stream when the consumer stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new TextEncoder().encode("data: x\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const _ of parseSse(body)) break;
    expect(cancelled).toBe(true);
  });
});
