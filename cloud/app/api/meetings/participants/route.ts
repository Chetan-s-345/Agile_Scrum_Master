import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

type UpdateBody = {
  roomName?: string;
  participantId?: string;
  role?: string;
  status?: "active" | "left" | "removed";
  participationNotes?: string;
};

type DeleteBody = {
  roomName?: string;
  participantId?: string;
};

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const url = new URL(request.url);
  const roomName = String(url.searchParams.get("roomName") || "").trim();
  if (!roomName) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "roomName is required" }, { status: 400 });
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(roomName)}/participants`,
    method: "GET",
    token,
  });
}

export async function PATCH(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as UpdateBody | null;
  const roomName = String(body?.roomName || "").trim();
  const participantId = String(body?.participantId || "").trim();

  if (!roomName || !participantId) {
    return NextResponse.json(
      { error: "Bad request", code: 400, detail: "roomName and participantId are required" },
      { status: 400 }
    );
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(roomName)}/participants/${encodeURIComponent(participantId)}`,
    method: "PATCH",
    token,
    body: {
      role: body?.role,
      status: body?.status,
      participationNotes: body?.participationNotes,
    },
  });
}

export async function DELETE(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as DeleteBody | null;
  const roomName = String(body?.roomName || "").trim();
  const participantId = String(body?.participantId || "").trim();

  if (!roomName || !participantId) {
    return NextResponse.json(
      { error: "Bad request", code: 400, detail: "roomName and participantId are required" },
      { status: 400 }
    );
  }

  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(roomName)}/participants/${encodeURIComponent(participantId)}`,
    method: "DELETE",
    token,
  });
}
