import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(_request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const { teamId } = await params;
  return proxyToApiGateway({
    upstreamPath: `/api/v1/teams/${encodeURIComponent(teamId)}/scores`,
    method: "GET",
    token,
  });
}
