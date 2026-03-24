import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  return proxyToApiGateway({
    upstreamPath: `/api/v1/goals/${encodeURIComponent(id)}/repos`,
    method: "POST",
    token,
    body: body ?? {},
  });
}
