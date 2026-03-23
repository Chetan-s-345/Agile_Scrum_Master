import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function POST() {
  const token = await getAuthTokenFromCookies();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  return proxyToApiGateway({
    upstreamPath: "/api/v1/admin/webhooks/retry-all-dlq",
    method: "POST",
    token,
  });
}
