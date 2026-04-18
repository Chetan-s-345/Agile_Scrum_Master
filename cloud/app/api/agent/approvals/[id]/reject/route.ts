import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { id } = await context.params;
  return proxyToApiGateway({
    upstreamPath: `/api/v1/agent/approvals/${encodeURIComponent(String(id || ""))}/reject`,
    method: "POST",
    token,
    body,
  });
}
