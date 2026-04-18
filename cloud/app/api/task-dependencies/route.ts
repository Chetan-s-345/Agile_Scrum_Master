import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const fromId = asString(body?.fromId);
  const toId = asString(body?.toId);

  if (!fromId || !toId) {
    return NextResponse.json({ error: "Validation failed", code: 400, detail: "fromId and toId are required" }, { status: 400 });
  }

  if (fromId === toId) {
    return NextResponse.json({ error: "Invalid dependency", code: 400, detail: "A task cannot depend on itself" }, { status: 400 });
  }

  // Backend endpoint not available yet. Return accepted so client can store local edge preview.
  return NextResponse.json({ ok: true, persisted: false, dependency: { fromId, toId } }, { status: 202 });
}
