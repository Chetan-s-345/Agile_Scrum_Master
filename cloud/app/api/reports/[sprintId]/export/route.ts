import { NextResponse } from "next/server";
import { getApiGatewayBaseUrl, getAuthTokenFromCookies } from "@/lib/api-gateway";

export async function GET(_request: Request, { params }: { params: Promise<{ sprintId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sprintId } = await params;
  const baseUrl = getApiGatewayBaseUrl();
  const upstreamUrl = `${baseUrl}/api/v1/reports/${encodeURIComponent(sprintId)}/export.csv`;

  const resp = await fetch(upstreamUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/csv",
    },
    cache: "no-store",
  });

  const text = await resp.text().catch(() => "");
  const disposition = resp.headers.get("content-disposition") || `attachment; filename=\"sprint-report-${sprintId}.csv\"`;

  return new Response(text, {
    status: resp.status,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": disposition,
    },
  });
}
