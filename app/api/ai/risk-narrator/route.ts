import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";
import { proxyToAiServiceSse } from "@/lib/ai-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  return proxyToAiServiceSse({
    upstreamPath: "/groq/risk-narrator/stream",
    method: "POST",
    body: body ?? {},
  });
}
