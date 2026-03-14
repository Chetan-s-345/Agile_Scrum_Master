import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(_request: Request, { params }: { params: Promise<{ sprintId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sprintId } = await params;

  return proxyToApiGateway({
    upstreamPath: `/api/v1/monitoring/sprint/${encodeURIComponent(sprintId)}/velocity`,
    method: "GET",
    token,
  });
}
