import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const url = new URL(request.url);
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  const limit = String(url.searchParams.get("limit") || "6").trim();
  if (!projectId) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "projectId is required." }, { status: 400 });
  }

  const query = new URLSearchParams();
  query.set("projectId", projectId);
  if (limit) query.set("limit", limit);

  return proxyToApiGateway({
    upstreamPath: `/api/v1/metrics/velocity?${query.toString()}`,
    method: "GET",
    token,
  });
}
