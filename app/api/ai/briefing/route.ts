import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const url = new URL(request.url);
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  const date = String(url.searchParams.get("date") || "today").trim();
  if (!projectId) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "projectId is required." }, { status: 400 });
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/ai/briefing?projectId=${encodeURIComponent(projectId)}&date=${encodeURIComponent(date)}`,
    method: "GET",
    token,
  });
}

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  return proxyToApiGateway({
    upstreamPath: "/api/v1/ai/autonomous/briefing",
    method: "POST",
    token,
    jsonBody: body,
  });
}
