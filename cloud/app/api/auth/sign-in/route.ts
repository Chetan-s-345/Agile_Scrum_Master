import { NextResponse } from "next/server";
import { getApiGatewayBaseUrl } from "@/lib/api-gateway";

function getGatewayBaseUrl() {
  return getApiGatewayBaseUrl();
}

function normalizeBaseUrl(raw: string | null | undefined, fallback: string) {
  const value = String(raw || fallback).trim();
  const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

async function warmUpServices() {
  const gatewayBaseUrl = normalizeBaseUrl(process.env.API_GATEWAY_URL, getGatewayBaseUrl());
  const aiBaseUrl = normalizeBaseUrl(process.env.AI_SERVICE_URL, "http://localhost:8000");

  const warm = (url: string) =>
    fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        "x-warmup": "signin",
      },
    }).catch(() => null);

  await Promise.allSettled([warm(`${gatewayBaseUrl}/health`), warm(`${aiBaseUrl}/health`)]);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim() : body?.email;
    const password = body?.password;
    const orgSlug = typeof body?.orgSlug === 'string' ? body.orgSlug.trim() : body?.orgSlug;

    if (!email || !password) {
      return NextResponse.json({ error: "Missing email or password" }, { status: 400 });
    }

    const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, orgSlug: orgSlug || undefined }),
      cache: "no-store",
    });

    const data = await gatewayResp.json().catch(() => null);
    if (!gatewayResp.ok) {
      return NextResponse.json(data || { error: "Sign-in failed" }, { status: gatewayResp.status });
    }

    if (data?.requiresOrgSelection) {
      return NextResponse.json(data, { status: 200 });
    }

    const accessToken = data?.tokens?.accessToken;
    const response = NextResponse.json(
      { user: data.user, org: data.org || null, requiresOrgSetup: Boolean(data?.requiresOrgSetup) },
      { status: 200 }
    );
    if (accessToken) {
      response.cookies.set({
        name: "auth_token",
        value: String(accessToken).trim(),
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    // Warm backend services in background after a successful login.
    void warmUpServices();

    return response;

  } catch (error) {
    console.error("Sign-in error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
