import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaveBody = {
  project_id?: unknown;
  repo_url?: unknown;
  analysis?: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token && process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => null)) as SaveBody | null;
    const projectId = typeof body?.project_id === "string" ? body.project_id.trim() : "";
    const repoUrl = typeof body?.repo_url === "string" ? body.repo_url.trim() : "";
    const analysis = body?.analysis;

    if (!projectId || !repoUrl || !isObject(analysis)) {
      return NextResponse.json(
        { error: "project_id, repo_url, and analysis are required", code: 400, detail: "Invalid GitNexus save payload" },
        { status: 400 }
      );
    }

    await query("DELETE FROM app.nexus_analyses WHERE project_id = $1", [projectId]);
    await query(
      "INSERT INTO app.nexus_analyses(project_id, repo_url, raw_payload, created_at, updated_at) VALUES ($1, $2, $3::jsonb, NOW(), NOW())",
      [projectId, repoUrl, JSON.stringify(analysis)]
    );

    return NextResponse.json({ ok: true, project_id: projectId }, { status: 200 });
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    return NextResponse.json({ error: "Failed to save analysis", code: 500, detail }, { status: 500 });
  }
}