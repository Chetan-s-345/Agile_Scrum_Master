import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function POST(req: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  return proxyToApiGateway({
    upstreamPath: "/api/v1/webhooks/jira/test",
    method: "POST",
    token,
    body,
  });
}
