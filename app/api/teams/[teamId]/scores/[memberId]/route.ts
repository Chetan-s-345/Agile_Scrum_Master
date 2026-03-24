import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function PATCH(request: Request, { params }: { params: Promise<{ teamId: string; memberId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const { teamId, memberId } = await params;
  const body = await request.json().catch(() => null);
  return proxyToApiGateway({
    upstreamPath: `/api/v1/teams/${encodeURIComponent(teamId)}/scores/${encodeURIComponent(memberId)}`,
    method: "PATCH",
    token,
    body: body ?? {},
  });
}
