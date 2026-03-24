import { NextResponse } from "next/server";
import { getAuthTokenFromCookies } from "@/lib/api-gateway";

const ITEMS = [
  { id: "c1", title: "Board tabs and route shell", date: "2026-03-24", detail: "Summary, Backlog, Board, Code, Timeline, Pages, and Forms tabs are now grouped under board." },
  { id: "c2", title: "Jira-style dashboard shell", date: "2026-03-24", detail: "Unified sidebar, navbar, and dark monochrome dashboard theme." },
  { id: "c3", title: "Brevo notifications", date: "2026-03-23", detail: "Notification bell can trigger email notifications through Brevo integration." },
];

export async function GET() {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }
  return NextResponse.json({ items: ITEMS });
}
