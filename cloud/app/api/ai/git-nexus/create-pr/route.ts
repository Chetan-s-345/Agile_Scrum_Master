import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";

function getAiServiceBaseUrl() {
  const raw = process.env.AI_SERVICE_URL || "http://localhost:8000";
  return raw.replace(/\/+$/, "");
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token && process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body?.repo || !body?.project_id) {
      return NextResponse.json({ error: "repo and project_id required" }, { status: 400 });
    }

    const resp = await fetch(`${getAiServiceBaseUrl()}/api/v1/git-nexus/create-pr`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const payload = await resp.json().catch(() => null);
    return new NextResponse(JSON.stringify(payload), { status: resp.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return NextResponse.json({ error: "Failed to create PR" }, { status: 500 });
  }
}
