import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET() {
  const token = await getAuthTokenFromCookies();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  return proxyToApiGateway({
    upstreamPath: "/api/v1/integrations/github/auto-task-rules",
    method: "GET",
    token,
  });
}

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  return proxyToApiGateway({
    upstreamPath: "/api/v1/integrations/github/auto-task-rules",
    method: "POST",
    token,
    body,
  });
}
