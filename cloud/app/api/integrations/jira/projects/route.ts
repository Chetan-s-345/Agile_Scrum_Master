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

export async function GET() {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/integrations/jira/projects`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const data = await gatewayResp.json().catch(() => null);
  return NextResponse.json(data || { error: "Upstream error" }, { status: gatewayResp.status });
}
