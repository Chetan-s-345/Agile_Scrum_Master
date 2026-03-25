import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const { id } = await params;
  const approvalId = String(id || "").trim();
  if (!approvalId) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "approval id is required." }, { status: 400 });
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/agents/approvals/${encodeURIComponent(approvalId)}/approve`,
    method: "PATCH",
    token,
    body: {},
  });
}
