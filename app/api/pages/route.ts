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
  const title = asString(body?.title);
  const content = asString(body?.content);
  if (!title || !content) {
    return NextResponse.json({ error: "Validation failed", code: 400, detail: "title and content are required" }, { status: 400 });
  }

  return NextResponse.json({
    page: {
      id: crypto.randomUUID(),
      title,
      content,
      createdAt: new Date().toISOString(),
    },
  }, { status: 201 });
}
