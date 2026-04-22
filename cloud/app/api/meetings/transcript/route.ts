import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

type TranscriptBody = {
  roomName?: string;
  transcript?: string;
};

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as TranscriptBody | null;
  const roomName = String(body?.roomName || "").trim();
  const transcript = String(body?.transcript || "").trim();

  if (!roomName) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "roomName is required" }, { status: 400 });
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(roomName)}/transcript`,
    method: "POST",
    token,
    body: { transcript },
  });
}
