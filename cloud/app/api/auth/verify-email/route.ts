import { NextResponse } from "next/server";

function getGatewayBaseUrl() {
  return process.env.API_GATEWAY_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
}

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const gatewayResp = await fetch(`${getGatewayBaseUrl()}/api/v1/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });

    const data = await gatewayResp.json().catch(() => null);
    if (!gatewayResp.ok) {
      return NextResponse.json(data || { error: "Verification failed" }, { status: gatewayResp.status });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Verify-email error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
