export type SseMessage = {
  event?: string;
  data: string;
};

export type StreamSseOptions = {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  onMessage: (msg: SseMessage) => void;
};

function decodeSseLines(chunkText: string, buffer: string) {
  // SSE messages are separated by a blank line.
  const text = buffer + chunkText;
  const parts = text.split(/\n\n/);
  const rest = parts.pop() ?? "";
  return { messages: parts, rest };
}

function parseSseMessage(raw: string): SseMessage | null {
  const lines = raw.split(/\n/);
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const data = dataLines.join("\n");
  if (!data) return null;
  return { event, data };
}

export async function streamSse({ url, method = "POST", body, signal, onMessage }: StreamSseOptions) {
  const resp = await fetch(url, {
    method,
    headers: {
      Accept: "text/event-stream",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`SSE request failed (${resp.status}): ${text.slice(0, 500)}`);
  }

  if (!resp.body) {
    throw new Error("SSE response has no body stream");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunkText = decoder.decode(value, { stream: true });
    const { messages, rest } = decodeSseLines(chunkText, buffer);
    buffer = rest;

    for (const m of messages) {
      const parsed = parseSseMessage(m);
      if (parsed) onMessage(parsed);
    }
  }
}
