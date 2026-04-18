import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET() {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await proxyToApiGateway({ upstreamPath: "/api/v1/org/invitations", method: "GET", token });

  // Normalize response shape for UI: UI expects `{ items: [...] }`.
  try {
    const body = await res.clone().json();
    if (body && Array.isArray(body.invitations) && !Array.isArray(body.items)) {
      return NextResponse.json(
        { items: body.invitations },
        {
          status: res.status,
          headers: {
            "x-upstream-url": res.headers.get("x-upstream-url") || "",
            "x-upstream-status": res.headers.get("x-upstream-status") || "",
          },
        }
      );
    }
  } catch {
    // Ignore JSON parse errors; return upstream response.
  }

  return res;
}
