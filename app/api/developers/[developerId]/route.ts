import { NextResponse } from "next/server";
import { cookies } from "next/headers";

function getGatewayBaseUrl() {
  return process.env.API_GATEWAY_URL || "http://localhost:4000";
}

async function getAuthToken() {
  const cookieStore = await cookies();
  return cookieStore.get("auth_token")?.value || null;
}

export async function GET(_request: Request, context: { params: { developerId: string } }) {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { developerId } = context.params;

  const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/developers/${encodeURIComponent(developerId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const data = await gatewayResp.json().catch(() => null);
  return NextResponse.json(data || { error: "Upstream error" }, { status: gatewayResp.status });
}

export async function PATCH(request: Request, context: { params: { developerId: string } }) {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { developerId } = context.params;
  const body = await request.json().catch(() => null);

  const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/developers/${encodeURIComponent(developerId)}`, {
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
