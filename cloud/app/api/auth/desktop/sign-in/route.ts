import { NextResponse } from "next/server";
import { getApiGatewayBaseUrl } from "@/lib/api-gateway";

function getGatewayBaseUrl() {
  return getApiGatewayBaseUrl();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim() : body?.email;
    const password = body?.password;
    const orgSlug = typeof body?.orgSlug === "string" ? body.orgSlug.trim() : body?.orgSlug;

    if (!email || !password) {
      return NextResponse.json({ error: "Missing email or password" }, { status: 400 });
    }

    const gatewayBaseUrl = getGatewayBaseUrl();
    if (
      process.env.NODE_ENV === "production" &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(gatewayBaseUrl)
    ) {
      return NextResponse.json(
        {
          error: "API gateway is not configured for production",
          detail: "Set API_GATEWAY_URL (or NEXT_PUBLIC_API_GATEWAY_URL) to your deployed api-gateway origin.",
        },
        { status: 500 }
      );
    }

    let gatewayResp;
    try {
      gatewayResp = await fetch(`${gatewayBaseUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, orgSlug: orgSlug || undefined }),
        cache: "no-store",
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: "Unable to reach API gateway",
          detail: error instanceof Error ? error.message : String(error),
          gatewayBaseUrl,
        },
        { status: 502 }
      );
    }

    const data = await gatewayResp.json().catch(() => null);
    if (!gatewayResp.ok) {
      return NextResponse.json(data || { error: "Sign-in failed" }, { status: gatewayResp.status });
    }

    if (data?.requiresOrgSelection) {
      return NextResponse.json(data, { status: 200 });
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
      { status: 200 }
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
    console.error("Desktop sign-in error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
