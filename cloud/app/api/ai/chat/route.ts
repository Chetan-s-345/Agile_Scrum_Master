import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const projectId = String(body?.projectId || body?.project_id || "").trim();
  const message = String(body?.message || "").trim();

  if (!projectId) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "projectId is required." }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Bad request", code: 400, detail: "message is required." }, { status: 400 });
  }

  const aiServiceUrl = (process.env.AI_SERVICE_URL || "http://localhost:8000").replace(/\/+$/, "");

  try {
    const response = await fetch(`${aiServiceUrl}/rag/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        project_id: projectId,
        source_types: Array.isArray(body?.source_types) ? body.source_types : undefined,
      }),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null);
    return NextResponse.json(payload ?? { error: "Upstream error", code: 502, detail: "Empty response from ai-service." }, { status: response.status });
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    return NextResponse.json({ error: "Bad gateway", code: 502, detail, upstream: `${aiServiceUrl}/rag/chat` }, { status: 502 });
  }
}
