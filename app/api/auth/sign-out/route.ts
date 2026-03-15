import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function POST() {
  const token = await getAuthTokenFromCookies();

  // Best effort upstream logout; always clear local cookie.
  if (token) {
    try {
      await proxyToApiGateway({ upstreamPath: "/api/v1/auth/logout", method: "POST", token });
    } catch {
      // ignore upstream failures and still clear cookie
    }
  }

  const resp = NextResponse.json({ ok: true });
  resp.cookies.set({
    name: "auth_token",
    value: "",
    path: "/",
    maxAge: 0,
  });
  return resp;
}
