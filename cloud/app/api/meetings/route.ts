import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const url = new URL(request.url);
  if (!url.searchParams.get("kind")) {
    url.searchParams.set("kind", "room");
  }
  const qs = url.searchParams.toString();
  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings${qs ? `?${qs}` : ""}`,
    method: "GET",
    token,
    timeoutMs: 60000,
  });
}

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const body = await request.json().catch(() => null);
  return proxyToApiGateway({
    upstreamPath: "/api/v1/meetings",
    method: "POST",
    token,
    body: body ?? {},
    timeoutMs: 90000,
  });
}
