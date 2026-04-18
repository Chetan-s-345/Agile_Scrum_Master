import { NextRequest, NextResponse } from "next/server";

function getGatewayBaseUrl() {
  return process.env.API_GATEWAY_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = await request.json().catch(() => ({}));

    const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/org/invitations/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const data = await gatewayResp.json().catch(() => null);
    if (!gatewayResp.ok) {
      return NextResponse.json(data || { error: "Accept failed" }, { status: gatewayResp.status });
    }

    const accessToken = data?.tokens?.accessToken;
    const response = NextResponse.json({ user: data.user, org: data.org }, { status: 200 });
    if (accessToken) {
      response.cookies.set({
        name: "auth_token",
        value: accessToken,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    return response;
  } catch (error) {
    console.error("Accept-invite error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
