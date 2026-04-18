import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function POST(_request: Request, { params }: { params: Promise<{ apiKeyId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { apiKeyId } = await params;

  return proxyToApiGateway({
    upstreamPath: `/api/v1/developer-tools/api-keys/${encodeURIComponent(apiKeyId)}/revoke`,
    method: "POST",
    token,
  });
}
