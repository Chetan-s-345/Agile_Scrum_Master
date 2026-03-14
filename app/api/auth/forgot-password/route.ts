import { NextResponse } from "next/server";

function getGatewayBaseUrl() {
  return process.env.API_GATEWAY_URL || "http://localhost:4000";
}

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });

    const data = await gatewayResp.json().catch(() => null);
    if (!gatewayResp.ok) {
      return NextResponse.json(data || { error: "Request failed" }, { status: gatewayResp.status });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Forgot-password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
