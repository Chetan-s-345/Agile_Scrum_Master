import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const { id } = await params;
  const safeId = asString(id).trim();
  if (!safeId) {
    return NextResponse.json({ error: "Invalid id", code: 400, detail: "Notification id is required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const current = cookieStore.get("asm_notifications_read")?.value || "";
  const parts = current.split(",").map((x) => x.trim()).filter(Boolean);
  if (!parts.includes(safeId)) parts.push(safeId);
  cookieStore.set("asm_notifications_read", parts.slice(-500).join(","), { path: "/", httpOnly: false, maxAge: 60 * 60 * 24 * 7 });

  return NextResponse.json({ ok: true });
}
