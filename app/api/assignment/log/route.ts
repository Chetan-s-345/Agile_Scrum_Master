import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const qs = url.searchParams.toString();

  return proxyToApiGateway({
    upstreamPath: `/api/v1/assignment/log${qs ? `?${qs}` : ""}`,
    method: "GET",
    token,
  });
}
