import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getApiGatewayBaseUrl } from "@/lib/api-gateway";

function getGatewayBaseUrl() {
  return getApiGatewayBaseUrl();
}

async function getAuthToken() {
  const cookieStore = await cookies();
  return cookieStore.get("auth_token")?.value || null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ sprintId: string }> }) {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sprintId } = await params;

  const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/sprints/${encodeURIComponent(sprintId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const data = await gatewayResp.json().catch(() => null);
  return NextResponse.json(data || { error: "Upstream error" }, { status: gatewayResp.status });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ sprintId: string }> }) {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sprintId } = await params;

  const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/sprints/${encodeURIComponent(sprintId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const data = await gatewayResp.json().catch(() => null);
  return NextResponse.json(data || { error: "Upstream error" }, { status: gatewayResp.status });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ sprintId: string }> }) {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sprintId } = await params;
  const body = await request.json().catch(() => null) as { startDate?: string; endDate?: string } | null;

  // Backend currently has no generic sprint date PATCH endpoint.
  return NextResponse.json(
    {
      ok: true,
      persisted: false,
      sprintId,
      startDate: body?.startDate,
      endDate: body?.endDate,
      detail: "Sprint date update endpoint is not available upstream yet",
    },
    { status: 202 }
  );
}
