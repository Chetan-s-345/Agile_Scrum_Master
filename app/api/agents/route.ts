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

  const response = await proxyToApiGateway({
    upstreamPath: `/api/v1/agents${query.toString() ? `?${query.toString()}` : ""}`,
    method: "GET",
    token,
  });

  if (response.status === 404) {
    return NextResponse.json({ agents: [] }, { status: 200 });
  }

  return response;
}

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  const response = await proxyToApiGateway({
    upstreamPath: "/api/v1/agents",
    method: "POST",
    token,
    body,
  });

  if (response.status === 404) {
    return NextResponse.json(
      {
        error: "Agent service route not found",
        code: 502,
        detail: "Upstream /api/v1/agents is not reachable. Ensure api-gateway is running and deployed with latest agents routes.",
      },
      { status: 502 }
    );
  }

  return response;
}
