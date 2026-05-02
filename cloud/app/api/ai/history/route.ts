import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  
  // Allow unauthenticated requests in development mode
  if (!token && process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const url = new URL(request.url);
  const qs = url.searchParams.toString();

  return proxyToApiGateway({
    upstreamPath: `/api/v1/ai/history${qs ? `?${qs}` : ""}`,
    method: "GET",
    token: token || undefined,
  });
}
