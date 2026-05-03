import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(_: Request, ctx: { params: Promise<{ roomId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const { roomId } = await ctx.params;
  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/rooms/${encodeURIComponent(roomId)}`,
    method: "GET",
    token,
    timeoutMs: 60000,
  });
}
