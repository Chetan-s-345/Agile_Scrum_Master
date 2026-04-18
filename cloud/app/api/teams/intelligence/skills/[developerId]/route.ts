import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ developerId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const { developerId } = await params;
  const id = String(developerId || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "developerId is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  return proxyToApiGateway({
    upstreamPath: `/api/v1/teams/intelligence/skills/${encodeURIComponent(id)}`,
    method: "PATCH",
    token,
    body,
  });
}
