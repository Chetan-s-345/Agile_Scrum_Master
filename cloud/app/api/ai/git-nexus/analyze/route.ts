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

    // Proxy to backend with SSE streaming while capturing the analysis JSON
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

    // If there's no body to stream, return as-is
    if (!response.body) {
      return new NextResponse(null, { status: response.status, headers: response.headers });
    }

    // Create a streaming passthrough that also inspects SSE 'data:' lines
    const reader = response.body.getReader();
    const textDecoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = "";

        async function trySaveAnalysis(candidate: unknown) {
          try {
            if (!candidate || typeof candidate !== "object") return;
            const candidateObj = candidate as Record<string, unknown>;
            const resultObj =
              candidateObj.result && typeof candidateObj.result === "object"
                ? (candidateObj.result as Record<string, unknown>)
                : null;
            const dataObj =
              candidateObj.data && typeof candidateObj.data === "object"
                ? (candidateObj.data as Record<string, unknown>)
                : null;
            const dataResultObj =
              dataObj?.result && typeof dataObj.result === "object"
                ? (dataObj.result as Record<string, unknown>)
                : null;

            // candidate may be the analysis object itself or contain it under result/data
            const possible =
              (candidateObj.repo_meta ? candidateObj : null) ||
              (resultObj?.repo_meta ? resultObj : null) ||
              (dataObj?.repo_meta ? dataObj : null) ||
              (dataResultObj?.repo_meta ? dataResultObj : null);

            if (!possible) return;

            const serialized = JSON.stringify(possible);
            await query("DELETE FROM app.nexus_analyses WHERE project_id = $1", [String(body.project_id || "default")]);
            await query(
              "INSERT INTO app.nexus_analyses(project_id, repo_url, raw_payload, created_at, updated_at) VALUES ($1, $2, $3::jsonb, NOW(), NOW())",
              [String(body.project_id || "default"), String(body.repo_url || ""), serialized],
            );
          } catch (e) {
            // swallow file write errors; don't break the stream
            console.error("Failed to save git-nexus analysis:", e);
          }
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // forward chunk immediately
          controller.enqueue(value);

          // accumulate text for SSE parsing
          buffer += textDecoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            try {
              const payload = JSON.parse(raw);
              // attempt to find and save the analysis/result
              await trySaveAnalysis(payload);
            } catch {
              // ignore JSON parse errors for SSE fragments
            }
          }
        }

        // final buffer flush
        if (buffer) {
          const parts = buffer.split("\n");
          for (const line of parts) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            try {
              const payload = JSON.parse(raw);
              await trySaveAnalysis(payload);
            } catch {}
          }
        }

        controller.close();
      },
      cancel() {
        try {
          reader.cancel();
        } catch {}
      },
    });

    // Return the passthrough stream to the client so the SSE behavior remains the same
    return new NextResponse(stream, {
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
