import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    // In development, skip auth completely
    const isDev = process.env.NODE_ENV === "development";
    if (!isDev) {
      try {
        const token = await getAuthTokenFromCookies();
        if (!token) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
      } catch (authError) {
        console.error("[GitNexus Last] Auth error:", authError instanceof Error ? authError.message : String(authError));
        // Don't fail on auth error in dev - just continue
        if (!isDev) {
          return NextResponse.json({ error: "Auth failed" }, { status: 401 });
        }
      }
    }

    const url = new URL(request.url);
    const projectId = String(url.searchParams.get("projectId") || "default");

    if (!projectId.trim()) {
      return NextResponse.json({ error: "Missing projectId parameter" }, { status: 400 });
    }

    console.log(`[GitNexus Last] Querying for projectId: ${projectId}`);
    
    const result = await query(
      "SELECT raw_payload FROM app.nexus_analyses WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1",
      [projectId],
    );

    console.log(`[GitNexus Last] Query result: ${result.rowCount} rows`);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0].raw_payload);
  } catch (e) {
    let errorMsg = "Unknown error";
    
    if (e instanceof Error) {
      errorMsg = e.message;
    } else if (typeof e === "object" && e !== null) {
      errorMsg = JSON.stringify(e);
    } else {
      errorMsg = String(e);
    }
    
    console.error("[GitNexus Last] Error:", errorMsg);
    console.error("[GitNexus Last] Full error:", e);
    
    return NextResponse.json(
      { error: "Database error", detail: errorMsg },
      { status: 500 }
    );
  }
}
