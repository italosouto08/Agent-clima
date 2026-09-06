import type { StreamEvent } from "./types";

function parseFrame(frame: string): StreamEvent | null {
  const dataLines: string[] = [];

  for (const raw of frame.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!dataLines.length) return null;
  return JSON.parse(dataLines.join("\n")) as StreamEvent;
}

export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (payload: StreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const payload = parseFrame(frame);
      if (payload) onEvent(payload);
    }
  }
}
