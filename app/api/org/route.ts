import { NextResponse } from "next/server";
import { cookies } from "next/headers";

function getGatewayBaseUrl() {
  return process.env.API_GATEWAY_URL || "http://localhost:4000";
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value || null;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const orgName = typeof body?.orgName === 'string' ? body.orgName.trim() : body?.orgName;
    const orgSlug = typeof body?.orgSlug === 'string' ? body.orgSlug.trim() : body?.orgSlug;
    const planSlug = typeof body?.planSlug === 'string' ? body.planSlug.trim() : body?.planSlug;
    const tenantDbConnectionString =
      typeof body?.tenantDbConnectionString === 'string' ? body.tenantDbConnectionString.trim() : body?.tenantDbConnectionString;

    if (!orgName || !orgSlug) {
      return NextResponse.json({ error: "Missing orgName or orgSlug" }, { status: 400 });
    }

    const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/org`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ orgName, orgSlug, planSlug, tenantDbConnectionString }),
      cache: "no-store",
    });

    const data = await gatewayResp.json().catch(() => null);
    if (!gatewayResp.ok) {
      return NextResponse.json(data || { error: "Create org failed" }, { status: gatewayResp.status });
    }

    const accessToken = data?.tokens?.accessToken;
    const response = NextResponse.json({ user: data.user, org: data.org }, { status: 201 });
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
