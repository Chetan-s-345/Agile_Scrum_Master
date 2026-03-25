import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getApiGatewayBaseUrl } from "@/lib/api-gateway";

async function getAuthToken() {
  const cookieStore = await cookies();
  return cookieStore.get("auth_token")?.value || null;
}

function getGatewayBaseUrl() {
  return getApiGatewayBaseUrl();
}

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });

  const { projectId } = await params;
  const gatewayResp = await fetch(
    `${getGatewayBaseUrl()}/api/v1/projects/${encodeURIComponent(projectId)}/automation-policy`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }
  );

  const data = await gatewayResp.json().catch(() => null);
  if (gatewayResp.status === 404) {
    return NextResponse.json(
      {
        createFromIssue: true,
        createFromPr: true,
        autoAssign: true,
        monitoringEnabled: true,
        guardedMode: false,
      },
      { status: 200 }
    );
  }

  return NextResponse.json(data || { error: "Upstream error", code: 502, detail: "Gateway response invalid." }, { status: gatewayResp.status });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token." }, { status: 401 });

  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));

  const gatewayResp = await fetch(
    `${getGatewayBaseUrl()}/api/v1/projects/${encodeURIComponent(projectId)}/automation-policy`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );

  const data = await gatewayResp.json().catch(() => null);
  if (gatewayResp.status === 404) {
    return NextResponse.json(
      {
        createFromIssue: Boolean(body?.createFromIssue),
        createFromPr: Boolean(body?.createFromPr),
        autoAssign: Boolean(body?.autoAssign),
        monitoringEnabled: Boolean(body?.monitoringEnabled),
        guardedMode: false,
      },
      { status: 200 }
    );
  }

  return NextResponse.json(data || { error: "Upstream error", code: 502, detail: "Gateway response invalid." }, { status: gatewayResp.status });
}
