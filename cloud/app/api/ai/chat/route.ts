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

    const raw = await response.text().catch(() => "");
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail =
        (payload && typeof payload === "object" && "detail" in payload && typeof (payload as { detail?: unknown }).detail === "string"
          ? (payload as { detail: string }).detail
          : "") ||
        raw ||
        `ai-service responded with ${response.status}`;

      return NextResponse.json(
        {
          error: "Chat request failed",
          code: response.status,
          detail,
        },
        { status: response.status }
      );
    }

    if (payload && typeof payload === "object") {
      return NextResponse.json(payload, { status: response.status });
    }

    return NextResponse.json(
      {
        error: "Chat request failed",
        code: 502,
        detail: raw || "Empty response from ai-service.",
      },
      { status: 502 }
    );
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    return NextResponse.json({ error: "Bad gateway", code: 502, detail, upstream: `${aiServiceUrl}/rag/chat` }, { status: 502 });
  }
}
