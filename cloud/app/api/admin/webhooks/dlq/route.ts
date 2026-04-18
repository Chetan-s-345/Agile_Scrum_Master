import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(req: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const qs = url.searchParams.toString();

  return proxyToApiGateway({
    upstreamPath: `/api/v1/admin/webhooks/dlq${qs ? `?${qs}` : ""}`,
    method: "GET",
    token,
  });
}
