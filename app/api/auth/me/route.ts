import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET() {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gatewayResp = await proxyToApiGateway({
    upstreamPath: "/api/v1/auth/me",
    method: "GET",
    token,
  });

  const data = await gatewayResp.json().catch(() => null);

  if (gatewayResp.status === 401) {
    const resp = NextResponse.json(data || { error: "Unauthorized" }, { status: 401 });
    resp.cookies.set({ name: "auth_token", value: "", path: "/", maxAge: 0 });
    return resp;
  }

  if (gatewayResp.status === 404) {
    return NextResponse.json(
      {
        error: "Auth profile endpoint not found on API gateway. Check API_GATEWAY_URL and ensure api-gateway is running.",
        details: data,
      },
      { status: 502 }
    );
  }

  return NextResponse.json(data || { error: "Upstream error" }, { status: gatewayResp.status });
}
