import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  return proxyToApiGateway({
    upstreamPath: `/api/v1/goals${qs ? `?${qs}` : ""}`,
    method: "GET",
    token,
  });
}

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const body = await request.json().catch(() => null);
  return proxyToApiGateway({
    upstreamPath: "/api/v1/goals",
    method: "POST",
    token,
    body: body ?? {},
  });
}
