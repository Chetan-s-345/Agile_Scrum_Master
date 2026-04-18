import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGatewaySse } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  return proxyToApiGatewaySse({
    upstreamPath: "/api/v1/ai/risk-narrator/stream",
    method: "POST",
    token,
    body: body ?? {},
  });
}
