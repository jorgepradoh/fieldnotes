/**
 * Server-Sent Events parser over a fetch body, per the WHATWG spec: lines end
 * in \n, \r\n or \r (even when a chunk boundary splits \r\n); `data:` lines of
 * one event are joined with \n; `:` lines are comments; an empty line
 * dispatches. A final event without a trailing blank line is still delivered.
 */
export interface SseEvent {
  event: string | null;
  data: string;
}

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let event: string | null = null;
  let data: string[] = [];

  const takeLine = (final: boolean): string | null => {
    const match = /\r\n|\n|\r/.exec(buffer);
    if (!match) return null;
    // A lone \r at the very end might be the first half of \r\n: wait for more.
    if (match[0] === "\r" && match.index === buffer.length - 1 && !final) return null;
    const line = buffer.slice(0, match.index);
    buffer = buffer.slice(match.index + match[0].length);
    return line;
  };

  const consume = (line: string): SseEvent | null => {
    if (line === "") {
      if (data.length === 0) {
        event = null;
        return null;
      }
      const out = { event, data: data.join("\n") };
      event = null;
      data = [];
      return out;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    return null;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let line = takeLine(false); line !== null; line = takeLine(false)) {
        const out = consume(line);
        if (out) yield out;
      }
    }
    buffer += decoder.decode();
    for (let line = takeLine(true); line !== null; line = takeLine(true)) {
      const out = consume(line);
      if (out) yield out;
    }
    if (buffer) {
      const out = consume(buffer);
      if (out) yield out;
    }
    if (data.length > 0) yield { event, data: data.join("\n") };
  } finally {
    // Stops the download if the consumer bailed out early (abort, [DONE], error).
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
  }
}
