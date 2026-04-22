import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

type JoinBody = {
  roomName?: string;
  participantName?: string;
  identity?: string;
  role?: string;
};

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as JoinBody | null;
  const roomName = String(body?.roomName || "").trim();
  const participantName = String(body?.participantName || "").trim();

  if (!roomName || !participantName) {
    return NextResponse.json(
      { error: "Bad request", code: 400, detail: "roomName and participantName are required" },
      { status: 400 }
    );
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(roomName)}/participants/join`,
    method: "POST",
    token,
    body: {
      participantName,
      identity: body?.identity,
      role: body?.role,
    },
  });
}
