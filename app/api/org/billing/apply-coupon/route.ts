import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  return proxyToApiGateway({
    upstreamPath: "/api/v1/org/billing/apply-coupon",
    method: "POST",
    token,
    body,
  });
}
