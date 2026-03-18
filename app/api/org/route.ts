import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

async function getAuthToken() {
  const cookieStore = await cookies();
  return cookieStore.get("auth_token")?.value || null;
}

export async function GET() {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return proxyToApiGateway({ upstreamPath: "/api/v1/org", method: "GET", token });
}

export async function POST(request: Request) {
  try {
    const token = await getAuthToken();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const orgName = typeof body?.orgName === 'string' ? body.orgName.trim() : body?.orgName;
    const orgSlug = typeof body?.orgSlug === 'string' ? body.orgSlug.trim() : body?.orgSlug;
    const planSlug = typeof body?.planSlug === 'string' ? body.planSlug.trim() : body?.planSlug;
    const autoResolveSlugCollision =
      typeof body?.autoResolveSlugCollision === 'boolean' ? body.autoResolveSlugCollision : true;

    if (!orgName || !orgSlug) {
      return NextResponse.json({ error: "Missing orgName or orgSlug" }, { status: 400 });
    }

    const proxyResp = await proxyToApiGateway({
      upstreamPath: "/api/v1/org",
      method: "POST",
      token,
      body: { orgName, orgSlug, planSlug, autoResolveSlugCollision },
    });

    const data = await proxyResp.json().catch(() => null);
    const response = NextResponse.json(data || { error: "Upstream error" }, { status: proxyResp.status });

    const accessToken = data?.tokens?.accessToken;
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
    return response;
    
  } catch (error) {
    console.error("Create org error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE() {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const proxyResp = await proxyToApiGateway({ upstreamPath: "/api/v1/org", method: "DELETE", token });

  // Always clear local auth cookie after delete attempt.
  proxyResp.cookies.set({
    name: "auth_token",
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return proxyResp;
}

