import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function POST(req: Request, ctx: { params: Promise<{ owner: string; repo: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { owner, repo } = await ctx.params;

  // No body required today, but allow one for future-proofing.
  const body = await req.json().catch(() => undefined);

  return proxyToApiGateway({
    upstreamPath: `/api/v1/integrations/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/connect`,
    method: "POST",
    token,
    body,
  });
}
