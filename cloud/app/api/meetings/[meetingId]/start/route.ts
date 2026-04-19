import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function POST(request: Request, ctx: { params: Promise<{ meetingId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const { meetingId } = await ctx.params;
  const incoming = (await request.json().catch(() => ({}))) as {
    provider?: string;
    joinUrl?: string;
    providerMeetingId?: string;
  };

  const body = {
    provider: incoming?.provider || "google_meet",
    joinUrl: incoming?.joinUrl,
    providerMeetingId: incoming?.providerMeetingId,
  };

  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(meetingId)}/start`,
    method: "POST",
    token,
    body,
    timeoutMs: 90000,
  });
}
