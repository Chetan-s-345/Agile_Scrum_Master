import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const qs = url.searchParams.toString();

  const upstream = await proxyToApiGateway({
    upstreamPath: `/api/v1/projects${qs ? `?${qs}` : ""}`,
    method: "GET",
    token,
  });

  if (upstream.status === 400) {
    const data = await upstream.clone().json().catch(() => null) as { error?: string } | null;
    if (String(data?.error || "").toLowerCase().includes("missing orgid")) {
      return NextResponse.json({ projects: [], requiresOrgSetup: true }, { status: 200 });
    }
  }

  return upstream;
}

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);

  return proxyToApiGateway({
    upstreamPath: "/api/v1/projects",
    method: "POST",
    token,
    body: body ?? {},
  });
}
