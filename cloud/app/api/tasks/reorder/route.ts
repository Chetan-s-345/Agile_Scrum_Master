import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";

export async function PATCH(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { orderedIds?: unknown } | null;
  const orderedIds = Array.isArray(body?.orderedIds) ? body!.orderedIds.filter((x) => typeof x === "string") as string[] : [];

  if (!orderedIds.length) {
    return NextResponse.json({ error: "Validation failed", code: 400, detail: "orderedIds is required" }, { status: 400 });
  }

  // Backend currently does not expose a persistent rank/order API.
  return NextResponse.json({ ok: true, persisted: false, orderedIds });
}
