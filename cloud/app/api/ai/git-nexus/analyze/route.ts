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
  
  // Allow unauthenticated requests in development mode
  if (!token && process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);

    // Validate required fields
    if (!body?.repo_url || !body?.project_id) {
      return NextResponse.json(
        { error: "repo_url and project_id are required" },
        { status: 400 }
      );
    }

    // Proxy to backend with SSE streaming
    const response = await fetch(`${getAiServiceBaseUrl()}/api/v1/git-nexus/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        repo_url: body.repo_url,
        project_id: body.project_id,
        branch: body.branch ?? "",
        since_days: body.since_days ?? 30,
        resource_tier: body.resource_tier ?? "",
        ram_mb: body.ram_mb,
        github_token: body.github_token,
        sprint_id: body.sprint_id,
      }),
      cache: "no-store",
    });

    return new NextResponse(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    console.error("[GitNexus Analyze] Error:", error);
    return NextResponse.json(
      { error: "Failed to start analysis" },
      { status: 500 }
    );
  }
}
