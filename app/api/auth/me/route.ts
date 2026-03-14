import { NextResponse } from "next/server";
import { cookies } from "next/headers";

function getGatewayBaseUrl() {
  return process.env.API_GATEWAY_URL || "http://localhost:4000";
}

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value || null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/auth/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const data = await gatewayResp.json().catch(() => null);

  if (gatewayResp.status === 401) {
    const resp = NextResponse.json(data || { error: "Unauthorized" }, { status: 401 });
    resp.cookies.set({ name: "auth_token", value: "", path: "/", maxAge: 0 });
    return resp;
  }

  return NextResponse.json(data || { error: "Upstream error" }, { status: gatewayResp.status });
}
