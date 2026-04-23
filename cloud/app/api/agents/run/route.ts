import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const agentId = String(body?.agentId || "").trim();
  if (!agentId) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "agentId is required." }, { status: 400 });
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/agents/${encodeURIComponent(agentId)}/run`,
    method: "POST",
    token,
    body,
    timeoutMs: 120000,
  });
}
