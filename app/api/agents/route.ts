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
  const query = new URLSearchParams();
  if (projectId) query.set("projectId", projectId);

  return proxyToApiGateway({
    upstreamPath: `/api/v1/agents${query.toString() ? `?${query.toString()}` : ""}`,
    method: "GET",
    token,
  });
}
