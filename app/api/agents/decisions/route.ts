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
  const query = new URLSearchParams();
  const all = String(url.searchParams.get("all") || "").trim();
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  const page = String(url.searchParams.get("page") || "1").trim();
  const agentType = String(url.searchParams.get("agentType") || "").trim();
  const fromDate = String(url.searchParams.get("fromDate") || "").trim();
  const toDate = String(url.searchParams.get("toDate") || "").trim();
  const resolutionType = String(url.searchParams.get("resolutionType") || "").trim();

  if (all) query.set("all", all);
  if (projectId) query.set("projectId", projectId);
  if (page) query.set("page", page);
  if (agentType) query.set("agentType", agentType);
  if (fromDate) query.set("fromDate", fromDate);
  if (toDate) query.set("toDate", toDate);
  if (resolutionType) query.set("resolutionType", resolutionType);

  return proxyToApiGateway({
    upstreamPath: `/api/v1/agents/decisions?${query.toString()}`,
    method: "GET",
    token,
  });
}
