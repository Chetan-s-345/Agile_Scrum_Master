import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

type NotificationItem = {
  id: string;
  text: string;
  href: string;
  createdAt: string;
  actor: { initials: string };
};

function toIso(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function parseReadIds(): Promise<Set<string>> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("asm_notifications_read")?.value || "";
  const list = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 500);
  return new Set(list);
}

async function buildNotifications(token: string): Promise<NotificationItem[]> {
  const [tasksResp, sprintsResp] = await Promise.all([
    proxyToApiGateway({ upstreamPath: "/api/v1/tasks", method: "GET", token }),
    proxyToApiGateway({ upstreamPath: "/api/v1/sprints", method: "GET", token }),
  ]);

  const tasksData = await tasksResp.json().catch(() => null) as { items?: unknown[] } | null;
  const sprintsData = await sprintsResp.json().catch(() => null) as { items?: unknown[] } | null;

  const tasks = Array.isArray(tasksData?.items) ? tasksData.items : [];
  const sprints = Array.isArray(sprintsData?.items) ? sprintsData.items : [];

  const taskItems: NotificationItem[] = tasks.slice(0, 8).map((item) => {
    const rec = (item || {}) as Record<string, unknown>;
    const id = asString(rec.id);
    const title = asString(rec.title) || "Task updated";
    return {
      id: `task-${id}`,
      text: `Task: ${title}`,
      href: `/tasks/${id}`,
      createdAt: toIso(rec.updatedAt || rec.created_at),
      actor: { initials: "TS" },
    };
  });

  const sprintItems: NotificationItem[] = sprints.slice(0, 8).map((item) => {
    const rec = (item || {}) as Record<string, unknown>;
    const id = asString(rec.id);
    const title = asString(rec.name) || "Sprint updated";
    const status = asString(rec.status) || "planning";
    return {
      id: `sprint-${id}`,
      text: `Sprint ${title} is ${status}`,
      href: `/sprints/${id}`,
      createdAt: toIso(rec.updatedAt || rec.updated_at || rec.startDate),
      actor: { initials: "SP" },
    };
  });

  return [...taskItems, ...sprintItems]
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .slice(0, 20);
}

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const readIds = await parseReadIds();
  const list = await buildNotifications(token);
  const url = new URL(request.url);
  const unreadOnly = String(url.searchParams.get("unread") || "").toLowerCase() === "true";

  const items = list.map((item) => ({ ...item, read: readIds.has(item.id) }));
  const filtered = unreadOnly ? items.filter((x) => !x.read) : items;

  return NextResponse.json({
    items: filtered.slice(0, 10),
    unreadCount: items.filter((x) => !x.read).length,
  });
}
