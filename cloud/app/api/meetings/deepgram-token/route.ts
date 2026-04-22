import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";

export async function GET() {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const key = String(process.env.DEEPGRAM_API_KEY || "").trim();
  if (!key) {
    return NextResponse.json({ error: "Deepgram key missing", code: 500, detail: "Set DEEPGRAM_API_KEY in environment" }, { status: 500 });
  }

  return NextResponse.json({ key });
}
