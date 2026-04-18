import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { taskId } = await params;

  return proxyToApiGateway({
    upstreamPath: `/api/v1/assignment/suggest/${encodeURIComponent(taskId)}`,
    method: "GET",
    token,
  });
}
