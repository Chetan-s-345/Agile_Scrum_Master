import { NextResponse } from "next/server";
import { cookies } from "next/headers";

function getGatewayBaseUrl() {
  return process.env.API_GATEWAY_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
}

async function getAuthToken() {
  const cookieStore = await cookies();
  return cookieStore.get("auth_token")?.value || null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ sprintId: string }> }) {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sprintId } = await params;

  const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/tasks/board/${encodeURIComponent(sprintId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const data = await gatewayResp.json().catch(() => null);
  return NextResponse.json(data || { error: "Upstream error" }, { status: gatewayResp.status });
}
