import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function POST(_req: Request, ctx: { params: Promise<{ eventId: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await ctx.params;

  return proxyToApiGateway({
    upstreamPath: `/api/v1/integrations/jira/webhook-logs/${encodeURIComponent(eventId)}/retry`,
    method: "POST",
    token,
  });
}
