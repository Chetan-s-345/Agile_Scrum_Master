type ProxySseOptions = {
  upstreamPath: string;
  method: "GET" | "POST";
  body?: unknown;
};

export function getAiServiceBaseUrl() {
  const raw = process.env.AI_SERVICE_URL || "http://localhost:8000";
  return raw.replace(/\/+$/, "");
}

export async function proxyToAiServiceSse({ upstreamPath, method, body }: ProxySseOptions): Promise<Response> {
  const baseUrl = getAiServiceBaseUrl();
  const normalizedPath = upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
  const upstreamUrl = `${baseUrl}${normalizedPath}`;

  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const resp = await fetch(upstreamUrl, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  // Pass-through response body + SSE headers.
  const outHeaders = new Headers(resp.headers);
  outHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
  outHeaders.set("Cache-Control", "no-cache, no-transform");
  outHeaders.set("Connection", "keep-alive");
  outHeaders.set("X-Accel-Buffering", "no");

  return new Response(resp.body, {
    status: resp.status,
    headers: outHeaders,
  });
}
