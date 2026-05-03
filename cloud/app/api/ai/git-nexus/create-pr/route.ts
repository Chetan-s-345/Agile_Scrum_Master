import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";
import { query } from "@/lib/db";

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

    // Ensure a persisted analysis exists for this project before creating a PR
    try {
      const check = await query("SELECT 1 FROM app.nexus_analyses WHERE project_id = $1 LIMIT 1", [String(body.project_id)]);
      if (check.rowCount === 0) {
        return NextResponse.json(
          { error: "No persisted analysis", code: 404, detail: `No persisted analysis found for project ${String(body.project_id)}. Run repository analysis first.` },
          { status: 404 }
        );
      }
    } catch (dbErr) {
      console.error('[create-pr] DB check error', dbErr);
      // continue and let proxy attempt if DB check cannot be performed
    }

    const aiServiceUrl = `${getAiServiceBaseUrl()}/api/v1/git-nexus/create-pr`;
    const resp = await fetch(aiServiceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const raw = await resp.text().catch(() => "");
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!resp.ok) {
      const detail =
        (payload && typeof payload === "object" && "detail" in payload && typeof (payload as { detail?: unknown }).detail === "string"
          ? (payload as { detail: string }).detail
          : "") ||
        raw ||
        `ai-service responded with ${resp.status}`;

      return NextResponse.json(
        {
          error: "Failed to create PR",
          code: resp.status,
          detail,
        },
        { status: resp.status }
      );
    }

    return NextResponse.json(payload ?? { ok: true }, { status: resp.status });
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    return NextResponse.json({ error: "Failed to create PR", code: 503, detail: `Unable to reach ai-service (${detail})` }, { status: 503 });
  }
}
