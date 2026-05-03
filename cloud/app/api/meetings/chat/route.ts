import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

type ChatBody = {
  roomName?: string;
  message?: string;
  participantName?: string;
};

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const url = new URL(request.url);
  const roomName = String(url.searchParams.get("roomName") || "").trim();
  const limit = String(url.searchParams.get("limit") || "").trim();

  if (!roomName) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "roomName is required" }, { status: 400 });
  }

  const query = new URLSearchParams();
  if (limit) {
    query.set("limit", limit);
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(roomName)}/messages${query.toString() ? `?${query.toString()}` : ""}`,
    method: "GET",
    token,
  });
}

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ChatBody | null;
  const roomName = String(body?.roomName || "").trim();
  const message = String(body?.message || "").trim();

  if (!roomName || !message) {
    return NextResponse.json(
      { error: "Bad request", code: 400, detail: "roomName and message are required" },
      { status: 400 }
    );
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(roomName)}/messages`,
    method: "POST",
    token,
    body: {
      message,
      participantName: body?.participantName,
    },
  });
}
