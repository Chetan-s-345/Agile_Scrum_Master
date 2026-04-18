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
  const sprintId = String(url.searchParams.get("sprintId") || "").trim();
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  if (!sprintId && !projectId) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "sprintId or projectId is required." }, { status: 400 });
  }

  const query = new URLSearchParams();
  if (sprintId) query.set("sprintId", sprintId);
  if (projectId) query.set("projectId", projectId);

  return proxyToApiGateway({
    upstreamPath: `/api/v1/metrics/risk-score?${query.toString()}`,
    method: "GET",
    token,
  });
}
