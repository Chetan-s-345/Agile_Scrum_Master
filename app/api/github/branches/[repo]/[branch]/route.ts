import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function DELETE(_request: Request, { params }: { params: Promise<{ repo: string; branch: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { repo, branch } = await params;

  return proxyToApiGateway({
    upstreamPath: `/api/v1/github/branches/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}`,
    method: "DELETE",
    token,
  });
}
