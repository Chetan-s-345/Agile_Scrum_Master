import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  return proxyToApiGateway({
    upstreamPath: `/api/v1/spaces/${encodeURIComponent(id)}/default`,
    method: "PATCH",
    token,
  });
}
