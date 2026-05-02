import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const token = await getAuthTokenFromCookies();
  return NextResponse.json({
    hasToken: !!token,
    tokenPrefix: token ? token.substring(0, 20) : null,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      JWT_SECRET: process.env.JWT_SECRET ? "SET" : "NOT_SET",
    },
  });
}
