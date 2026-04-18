import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(_request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const { teamId } = await params;
  return proxyToApiGateway({
    upstreamPath: `/api/v1/teams/${encodeURIComponent(teamId)}/join-requests`,
    method: "GET",
    token,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const { teamId } = await params;
  const body = await request.json().catch(() => null);
  return proxyToApiGateway({
    upstreamPath: `/api/v1/teams/${encodeURIComponent(teamId)}/join-requests`,
    method: "POST",
    token,
    body: body ?? {},
  });
}
