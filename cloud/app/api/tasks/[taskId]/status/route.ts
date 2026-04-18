import { NextResponse } from "next/server";
import { cookies } from "next/headers";

function getGatewayBaseUrl() {
  return process.env.API_GATEWAY_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
}

async function getAuthToken() {
  const cookieStore = await cookies();
  return cookieStore.get("auth_token")?.value || null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { taskId } = await params;
  const body = await request.json().catch(() => null);

  const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/tasks/${encodeURIComponent(taskId)}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });

  const data = await gatewayResp.json().catch(() => null);
  return NextResponse.json(data || { error: "Upstream error" }, { status: gatewayResp.status });
}
