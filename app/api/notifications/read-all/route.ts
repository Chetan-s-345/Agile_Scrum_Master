import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";

export async function PATCH() {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const current = cookieStore.get("asm_notifications_read")?.value || "";
  cookieStore.set("asm_notifications_read", current ? `${current},*` : "*", { path: "/", httpOnly: false, maxAge: 60 * 60 * 24 * 7 });

  return NextResponse.json({ ok: true });
}
