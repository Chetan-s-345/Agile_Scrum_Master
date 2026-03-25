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
  const status = String(url.searchParams.get("status") || "").trim();
  if (!projectId) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "projectId is required." }, { status: 400 });
  }

  const query = new URLSearchParams({ projectId });
  if (status) query.set("status", status);

  return proxyToApiGateway({
    upstreamPath: `/api/v1/sprint-autopilot/proposals?${query.toString()}`,
    method: "GET",
    token,
  });
}
