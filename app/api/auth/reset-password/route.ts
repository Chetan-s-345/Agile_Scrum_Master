import { NextResponse } from "next/server";

function getGatewayBaseUrl() {
  return process.env.API_GATEWAY_URL || "http://localhost:4000";
}

export async function POST(request: Request) {
  try {
    const { token, newPassword } = await request.json();

    if (!token || !newPassword) {
      return NextResponse.json({ error: "Missing token or newPassword" }, { status: 400 });
    }

    const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
      cache: "no-store",
    });

    const data = await gatewayResp.json().catch(() => null);
    if (!gatewayResp.ok) {
      return NextResponse.json(data || { error: "Reset failed" }, { status: gatewayResp.status });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Reset-password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
