import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);

    if (!body?.tasks || !Array.isArray(body.tasks)) {
      return NextResponse.json(
        { error: "tasks array is required" },
        { status: 400 }
      );
    }

    if (!body?.project_id) {
      return NextResponse.json(
        { error: "project_id is required" },
        { status: 400 }
      );
    }

    // TODO: Implement actual database insertion
    // For now, return success response
    const imported = body.tasks.length;

    return NextResponse.json(
      {
        imported,
        failed: 0,
        errors: [],
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[Bulk Create Tasks] Error:", error);
    return NextResponse.json(
      { error: "Failed to create tasks" },
      { status: 500 }
    );
  }
}
