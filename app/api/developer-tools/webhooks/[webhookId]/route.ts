import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function PATCH(request: Request, { params }: { params: Promise<{ webhookId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { webhookId } = await params;
  const body = await request.json().catch(() => null);

  return proxyToApiGateway({
    upstreamPath: `/api/v1/developer-tools/webhooks/${encodeURIComponent(webhookId)}`,
    method: "PATCH",
    token,
    body: body ?? {},
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ webhookId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { webhookId } = await params;

  return proxyToApiGateway({
    upstreamPath: `/api/v1/developer-tools/webhooks/${encodeURIComponent(webhookId)}`,
    method: "DELETE",
    token,
  });
}
