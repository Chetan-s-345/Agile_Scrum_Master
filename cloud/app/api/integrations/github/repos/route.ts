import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export async function GET(req: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const search = url.searchParams.toString();

  return proxyToApiGateway({
    upstreamPath: `/api/v1/integrations/github/repos${search ? `?${search}` : ""}`,
    method: "GET",
    token,
  });
}
