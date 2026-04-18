import { NextResponse } from "next/server";
import { getApiGatewayBaseUrl } from "@/lib/api-gateway";

function getGatewayBaseUrl() {
  return getApiGatewayBaseUrl();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : body?.fullName;
    const email = typeof body?.email === "string" ? body.email.trim() : body?.email;
    const password = body?.password;

    if (!fullName || !email || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email, password }),
      cache: "no-store",
    });

    const data = await gatewayResp.json().catch(() => null);
    if (!gatewayResp.ok) {
      return NextResponse.json(data || { error: "Sign-up failed" }, { status: gatewayResp.status });
    }

    const accessToken = String(data?.tokens?.accessToken || "").trim();
    if (!accessToken) {
      return NextResponse.json({ error: "Missing access token" }, { status: 502 });
    }

    const response = NextResponse.json(
      {
        user: data.user,
        org: data.org || null,
        requiresOrgSetup: Boolean(data?.requiresOrgSetup),
        accessToken,
      },
      { status: 201 }
    );

    response.cookies.set({
      name: "auth_token",
      value: accessToken,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    console.error("Desktop sign-up error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
