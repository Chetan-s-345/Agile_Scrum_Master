import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(_req: Request, ctx: { params: Promise<{ owner: string; repo: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { owner, repo } = await ctx.params;

  return proxyToApiGateway({
    upstreamPath: `/api/v1/integrations/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    method: "GET",
    token,
  });
}
