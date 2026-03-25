import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ agentName: string }> }
) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { agentName } = await params;
  const name = String(agentName || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "agentName is required." }, { status: 400 });
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/agents/${encodeURIComponent(name)}/pause`,
    method: "PATCH",
    token,
    jsonBody: body,
  });
}
