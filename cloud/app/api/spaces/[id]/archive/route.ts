import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);

  return proxyToApiGateway({
    upstreamPath: `/api/v1/spaces/${encodeURIComponent(id)}/archive`,
    method: "PATCH",
    token,
    body: body ?? {},
  });
}
