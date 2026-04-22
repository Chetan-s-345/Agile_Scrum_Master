import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(_: Request, ctx: { params: Promise<{ meetingId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const { meetingId } = await ctx.params;
  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(meetingId)}`,
    method: "GET",
    token,
    timeoutMs: 60000,
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ meetingId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const { meetingId } = await ctx.params;
  const body = await request.json().catch(() => null);
  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(meetingId)}`,
    method: "PATCH",
    token,
    body: body ?? {},
  });
}

export async function PUT(request: Request, ctx: { params: Promise<{ meetingId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const { meetingId } = await ctx.params;
  const body = await request.json().catch(() => null);
  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(meetingId)}`,
    method: "PUT",
    token,
    body: body ?? {},
  });
}

export async function DELETE(_: Request, ctx: { params: Promise<{ meetingId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });

  const { meetingId } = await ctx.params;
  return proxyToApiGateway({
    upstreamPath: `/api/v1/meetings/${encodeURIComponent(meetingId)}`,
    method: "DELETE",
    token,
  });
}
