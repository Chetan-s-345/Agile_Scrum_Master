import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET() {
  const token = await getAuthTokenFromCookies();
  
  // Allow unauthenticated requests in development mode
  if (!token && process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return proxyToApiGateway({
    upstreamPath: "/api/v1/spaces",
    method: "GET",
    token: token || undefined,
  });
}
