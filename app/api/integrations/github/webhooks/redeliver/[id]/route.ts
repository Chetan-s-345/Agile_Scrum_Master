import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  return proxyToApiGateway({
    upstreamPath: `/api/v1/integrations/github/webhooks/redeliver/${encodeURIComponent(id)}`,
    method: "POST",
    token,
  });
}
