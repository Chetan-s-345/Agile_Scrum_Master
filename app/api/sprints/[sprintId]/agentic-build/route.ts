import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getApiGatewayBaseUrl } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AgenticBuildRequest = {
  projectId?: string;
  projectDetails: string;
  maxTickets?: number;
};

type GatewaySprint = {
  id: string;
  name: string;
  project_id?: string;
  projectId?: string;
};

type GatewayGetSprintResponse = {
  sprint: GatewaySprint;
};

type GatewayDeveloperListItem = {
  id: string;
  fullName?: string;
  name?: string;
  techStack?: string[];
  meritScore?: number;
  currentLoad?: number;
  maxCapacity?: number;
};

type GatewayListDevelopersResponse = {
  items: GatewayDeveloperListItem[];
};

type AgenticTicket = {
  id: string;
  title: string;
  description?: string | null;
  labels?: string[];
  story_points?: number | null;
  priority?: string | null;
  required_skills?: string[];
};

type AgenticAssignment = {
  ticket_id: string;
  developer_id: string;
  rationale?: string;
};

type AgenticFinalPlan = {
  sprint_name?: string;
  assignments?: AgenticAssignment[];
  risks?: unknown[];
  summary?: unknown;
};

type AgenticBuildResponse = {
  sprint_goal?: string | null;
  generated_tickets?: AgenticTicket[];
  selected_ticket_ids?: string[];
  final_plan?: AgenticFinalPlan | null;
  transcript?: unknown[];
};

type GatewayCreateTaskResponse = {
  task?: { id: string } & Record<string, unknown>;
  assignment?: unknown;
};

function priorityToGatewayPriority(p: unknown): string {
  const v = String(p || "").toUpperCase();
  if (v === "P0") return "critical";
  if (v === "P1") return "high";
  if (v === "P2") return "medium";
  if (v === "P3") return "low";
  return "medium";
}

async function getAuthToken() {
  const cookieStore = await cookies();
  return cookieStore.get("auth_token")?.value || null;
}

async function gatewayFetchJson<T>(token: string, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null; raw: unknown }> {
  const base = getApiGatewayBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  const raw = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, data: (raw as T) ?? null, raw };
}

export async function POST(request: Request, { params }: { params: Promise<{ sprintId: string }> }) {
  const token = await getAuthToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sprintId } = await params;
  const body = (await request.json().catch(() => null)) as AgenticBuildRequest | null;

  const projectDetails = String(body?.projectDetails || "").trim();
  if (!projectDetails) return NextResponse.json({ error: "projectDetails is required" }, { status: 400 });

  // Fetch sprint (to discover projectId and sprint name)
  const sprintResp = await gatewayFetchJson<GatewayGetSprintResponse>(token, `/api/v1/sprints/${encodeURIComponent(sprintId)}`, { method: "GET" });
  if (!sprintResp.ok) return NextResponse.json(sprintResp.raw || { error: "Failed to load sprint" }, { status: sprintResp.status });

  const sprint = sprintResp.data?.sprint;
  const projectId = String(body?.projectId || sprint?.project_id || sprint?.projectId || "");
  const sprintName = String(sprint?.name || "Sprint");
  if (!projectId) return NextResponse.json({ error: "projectId not found for sprint" }, { status: 400 });

  // Load developers for the org
  const devResp = await gatewayFetchJson<GatewayListDevelopersResponse>(token, `/api/v1/developers`, { method: "GET" });
  if (!devResp.ok) return NextResponse.json(devResp.raw || { error: "Failed to load developers" }, { status: devResp.status });

  const devItems = Array.isArray(devResp.data?.items) ? devResp.data?.items : [];
  const developers = devItems.map((d) => ({
    id: String(d.id),
    name: String(d.fullName || d.name || "Developer"),
    tech_stack: Array.isArray(d.techStack) ? d.techStack.map(String) : [],
    merit_score: Number.isFinite(Number(d.meritScore)) ? Number(d.meritScore) : undefined,
    current_load_points: Number.isFinite(Number(d.currentLoad)) ? Number(d.currentLoad) : undefined,
    sprint_capacity_points: Number.isFinite(Number(d.maxCapacity)) ? Number(d.maxCapacity) : undefined,
  }));

  // Ask AI service (via gateway) to generate tickets + plan assignments
  const aiPayload = {
    sprint_name: sprintName,
    project_details: projectDetails,
    developers,
    constraints: {},
    max_tickets: Number.isFinite(Number(body?.maxTickets)) ? Number(body?.maxTickets) : 12,
  };

  const aiResp = await gatewayFetchJson<AgenticBuildResponse>(token, `/api/v1/ai/agentic/sprint-build`, {
    method: "POST",
    body: JSON.stringify(aiPayload),
  });
  if (!aiResp.ok) return NextResponse.json(aiResp.raw || { error: "Agentic sprint build failed" }, { status: aiResp.status });

  const generated = Array.isArray(aiResp.data?.generated_tickets) ? aiResp.data.generated_tickets : [];
  const selectedIds = Array.isArray(aiResp.data?.selected_ticket_ids) ? aiResp.data.selected_ticket_ids : [];

  const byId = new Map<string, AgenticTicket>(generated.map((t) => [String(t.id || ""), t]));

  const createdTasks: Array<Record<string, unknown>> = [];
  const ticketIdToTaskId = new Map<string, string>();

  for (const ticketId of selectedIds) {
    const t = byId.get(String(ticketId));
    if (!t) continue;

    const storyPoints = Number.isFinite(Number(t.story_points)) ? Math.max(0, Math.round(Number(t.story_points))) : 3;
    const techTags = [
      ...(Array.isArray(t.required_skills) ? t.required_skills : []),
      ...(Array.isArray(t.labels) ? t.labels : []),
    ].map(String);

    const taskCreateBody = {
      sprintId,
      projectId,
      title: String(t.title || "Untitled"),
      description: t.description ? String(t.description) : undefined,
      storyPoints,
      priority: priorityToGatewayPriority(t.priority),
      techTags,
      autoAssign: false,
    };

    const taskResp = await gatewayFetchJson<GatewayCreateTaskResponse>(token, `/api/v1/tasks`, {
      method: "POST",
      body: JSON.stringify(taskCreateBody),
    });
    if (!taskResp.ok) {
      return NextResponse.json(
        {
          error: "Task creation failed",
          ticketId,
          upstream: taskResp.raw,
        },
        { status: taskResp.status }
      );
    }

    const createdTask = taskResp.data?.task;
    const createdTaskId = String(createdTask?.id || "");

    if (createdTaskId) ticketIdToTaskId.set(String(ticketId), createdTaskId);
    createdTasks.push((createdTask as Record<string, unknown>) || taskCreateBody);
  }

  const assignments = Array.isArray(aiResp.data?.final_plan?.assignments) ? aiResp.data.final_plan.assignments : [];
  const assignmentResults: Array<Record<string, unknown>> = [];

  for (const a of assignments) {
    const ticketId = String(a.ticket_id || "");
    const developerId = String(a.developer_id || "");
    const taskId = ticketIdToTaskId.get(ticketId);
    if (!taskId || !developerId) continue;

    const assignResp = await gatewayFetchJson<Record<string, unknown>>(token, `/api/v1/assignment/assign-explicit`, {
      method: "POST",
      body: JSON.stringify({ taskId, sprintId, developerId, reason: a.rationale || "Agentic plan assignment" }),
    });

    assignmentResults.push({ ticketId, taskId, developerId, ok: assignResp.ok, status: assignResp.status, data: assignResp.raw as unknown });
    if (!assignResp.ok) {
      return NextResponse.json(
        {
          error: "Assignment failed",
          ticketId,
          taskId,
          developerId,
          upstream: assignResp.raw,
        },
        { status: assignResp.status }
      );
    }
  }

  return NextResponse.json(
    {
      sprintId,
      projectId,
      sprintName,
      agentic: {
        sprintGoal: aiResp.data?.sprint_goal || null,
        selectedTicketIds: selectedIds,
        finalPlan: aiResp.data?.final_plan || null,
        risks: aiResp.data?.final_plan?.risks || [],
        summary: aiResp.data?.final_plan?.summary || null,
      },
      createdTasks,
      assignmentResults,
      transcript: aiResp.data?.transcript || [],
    },
    { status: 200 }
  );
}
