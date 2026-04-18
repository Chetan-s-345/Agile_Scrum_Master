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

export async function POST(request: Request) {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);

  const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/integrations/jira/connect`, {
    method: "POST",
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
