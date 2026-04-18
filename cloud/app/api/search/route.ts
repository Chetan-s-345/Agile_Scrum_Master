import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

type SearchResultItem = {
  id: string;
  type: "task" | "sprint" | "developer" | "page";
  title: string;
  subtitle: string;
  href: string;
};

async function fetchItems(token: string, path: string): Promise<unknown[]> {
  const resp = await proxyToApiGateway({ upstreamPath: path, method: "GET", token });
  if (!resp.ok) return [];
  const data = await resp.json().catch(() => null) as { items?: unknown[] } | null;
  return Array.isArray(data?.items) ? data.items : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function GET(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized", code: 401, detail: "Missing auth token" }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = asString(url.searchParams.get("q")).trim();
  const projectId = asString(url.searchParams.get("projectId")).trim();

  if (q.length < 2) {
    return NextResponse.json({
      tasks: [],
      sprints: [],
      developers: [],
      pages: [],
    });
  }

  const taskPath = `/api/v1/tasks${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`;
  const sprintPath = `/api/v1/sprints${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`;

  const [tasksRaw, sprintsRaw, devsRaw] = await Promise.all([
    fetchItems(token, taskPath),
    fetchItems(token, sprintPath),
    fetchItems(token, "/api/v1/developers"),
  ]);

  const lower = q.toLowerCase();

  const tasks: SearchResultItem[] = tasksRaw
    .map((item) => {
      const rec = (item || {}) as Record<string, unknown>;
      const id = asString(rec.id);
      const title = asString(rec.title);
      const status = asString(rec.status) || "task";
      return {
        id,
        type: "task" as const,
        title,
        subtitle: status,
        href: `/tasks/${id}`,
      };
    })
    .filter((item) => item.id && item.title.toLowerCase().includes(lower))
    .slice(0, 8);

  const sprints: SearchResultItem[] = sprintsRaw
    .map((item) => {
      const rec = (item || {}) as Record<string, unknown>;
      const id = asString(rec.id);
      const title = asString(rec.name);
      const status = asString(rec.status) || "sprint";
      return {
        id,
        type: "sprint" as const,
        title,
        subtitle: status,
        href: `/sprint/${id}`,
      };
    })
    .filter((item) => item.id && item.title.toLowerCase().includes(lower))
    .slice(0, 8);

  const developers: SearchResultItem[] = devsRaw
    .map((item) => {
      const rec = (item || {}) as Record<string, unknown>;
      const id = asString(rec.id);
      const title = asString(rec.name) || asString(rec.fullName);
      const role = asString(rec.role) || "developer";
      return {
        id,
        type: "developer" as const,
        title,
        subtitle: role,
        href: `/developers/${id}`,
      };
    })
    .filter((item) => item.id && item.title.toLowerCase().includes(lower))
    .slice(0, 8);

  const pages: SearchResultItem[] = [
    {
      id: "board",
      type: "page" as const,
      title: "Board",
      subtitle: "Navigation",
      href: "/board",
    },
    {
      id: "timeline",
      type: "page" as const,
      title: "Timeline",
      subtitle: "Navigation",
      href: "/board/timeline",
    },
    {
      id: "backlog",
      type: "page" as const,
      title: "Backlog",
      subtitle: "Navigation",
      href: "/backlog",
    },
    {
      id: "goals",
      type: "page" as const,
      title: "Goals",
      subtitle: "Navigation",
      href: "/goals",
    },
    {
      id: "github",
      type: "page" as const,
      title: "GitHub",
      subtitle: "Navigation",
      href: "/github",
    },
  ].filter((item) => item.title.toLowerCase().includes(lower));

  return NextResponse.json({ tasks, sprints, developers, pages });
}
