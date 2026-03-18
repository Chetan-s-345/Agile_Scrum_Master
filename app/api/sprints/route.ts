import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";
import { inngest } from "@/inngest/client";

function getStringProp(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const v = rec[key];
  return typeof v === "string" ? v : null;
}

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const qs = url.searchParams.toString();

  const upstream = await proxyToApiGateway({
    upstreamPath: `/api/v1/sprints${qs ? `?${qs}` : ""}`,
    method: "GET",
    token,
  });

  if (upstream.status === 400) {
    const data = await upstream.clone().json().catch(() => null) as { error?: string } | null;
    if (String(data?.error || "").toLowerCase().includes("missing orgid")) {
      return NextResponse.json({ sprints: [], requiresOrgSetup: true }, { status: 200 });
    }
  }

  return upstream;
}

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);

  const resp = await proxyToApiGateway({
    upstreamPath: "/api/v1/sprints",
    method: "POST",
    token,
    body: body ?? {},
  });

  if (resp.ok) {
    const payload = await resp.clone().json().catch(() => null);
    const sprintName = getStringProp(payload, "name") ?? getStringProp(body, "name") ?? "Sprint";

    // Fire-and-forget: do not block API response on background workflows.
    void inngest.send({
      name: "sprint/created",
      data: {
        sprintName,
        sprint: payload,
        requestBody: body ?? {},
      },
    });
  }

  return resp;
}
