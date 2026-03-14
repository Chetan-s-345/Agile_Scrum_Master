import { cookies } from "next/headers";
import { NextResponse } from "next/server";

type ProxyOptions = {
  upstreamPath: string;
  method: string;
  token?: string | null;
  body?: unknown;
};

export function getApiGatewayBaseUrl() {
  const raw = process.env.API_GATEWAY_URL || "http://localhost:4000";
  return raw.replace(/\/+$/, "");
}

export async function getAuthTokenFromCookies() {
  const cookieStore = await cookies();
  return cookieStore.get("auth_token")?.value || null;
}

async function readGatewayResponse(resp: Response): Promise<{ json: unknown | null; text: string | null }> {
  const text = await resp.text().catch(() => null);
  if (!text) return { json: null, text: null };

  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

export async function proxyToApiGateway({ upstreamPath, method, token, body }: ProxyOptions) {
  const baseUrl = getApiGatewayBaseUrl();
  const normalizedPath = upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
  const upstreamUrl = `${baseUrl}${normalizedPath}`;

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let resp: Response;
  try {
    resp = await fetch(upstreamUrl, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Bad gateway",
        details: message,
        upstream: { baseUrl, url: upstreamUrl },
        hint: "Ensure the API gateway is running and API_GATEWAY_URL is set to its origin.",
      },
      { status: 502 }
    );
  }

  const { json, text } = await readGatewayResponse(resp);
  const payload =
    json ??
    (text
      ? {
          error: "Upstream returned non-JSON",
          upstream: { url: upstreamUrl, status: resp.status },
          bodySnippet: text.slice(0, 2000),
        }
      : { error: "Upstream error", upstream: { url: upstreamUrl, status: resp.status } });

  return NextResponse.json(payload, {
    status: resp.status,
    headers: {
      "x-upstream-url": upstreamUrl,
      "x-upstream-status": String(resp.status),
    },
  });
}
