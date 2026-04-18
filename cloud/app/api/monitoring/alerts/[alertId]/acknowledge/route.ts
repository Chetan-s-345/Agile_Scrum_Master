import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function PATCH(request: Request, { params }: { params: Promise<{ alertId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { alertId } = await params;
  const body = await request.json().catch(() => null);

  return proxyToApiGateway({
    upstreamPath: `/api/v1/monitoring/alerts/${encodeURIComponent(alertId)}/acknowledge`,
    method: "PATCH",
    token,
    body: body ?? {},
  });
}
