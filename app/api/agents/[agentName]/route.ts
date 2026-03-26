import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ agentName: string }> }
) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const { agentName } = await params;
  const id = String(agentName || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "agent id is required." }, { status: 400 });
  }

  const url = new URL(request.url);
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  if (!projectId) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "projectId is required." }, { status: 400 });
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/agents/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}`,
    method: "DELETE",
    token,
  });
}
