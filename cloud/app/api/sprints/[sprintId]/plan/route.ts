import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function POST(request: Request, { params }: { params: Promise<{ sprintId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sprintId } = await params;
  const body = await request.json().catch(() => null);

  return proxyToApiGateway({
    upstreamPath: `/api/v1/sprints/${encodeURIComponent(sprintId)}/plan`,
    method: "POST",
    token,
    body: body ?? {},
  });
}
