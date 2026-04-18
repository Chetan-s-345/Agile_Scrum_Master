import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET() {
  const token = await getAuthTokenFromCookies();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  return proxyToApiGateway({
    upstreamPath: "/api/v1/integrations/github/webhook-deliveries",
    method: "GET",
    token,
  });
}
