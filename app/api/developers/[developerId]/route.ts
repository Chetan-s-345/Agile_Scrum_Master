import { NextRequest, NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ developerId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { developerId } = await params;

  return proxyToApiGateway({
    upstreamPath: `/api/v1/developers/${encodeURIComponent(developerId)}`,
    method: "GET",
    token,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ developerId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { developerId } = await params;
  const body = await request.json().catch(() => null);

  return proxyToApiGateway({
    upstreamPath: `/api/v1/developers/${encodeURIComponent(developerId)}`,
    method: "PATCH",
    token,
    body: body ?? {},
  });
}
