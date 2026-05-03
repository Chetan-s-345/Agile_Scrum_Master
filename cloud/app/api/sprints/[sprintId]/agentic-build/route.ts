import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getApiGatewayBaseUrl } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AgenticBuildRequest = {
  projectId?: string;
  projectDetails: string;
  maxTickets?: number;
  minTickets?: number;
  mirrorToGithub?: boolean;
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
  githubUsername?: string;
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

type GatewayCreateGithubIssueResponse = {
  issue?: {
    id?: number | string;
    number?: number;
    title?: string;
    url?: string;
    htmlUrl?: string;
    repo?: string;
  };
};

const DEFAULT_MIN_TICKETS = 8;
const MAX_TICKETS_LIMIT = 20;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 45000;

function buildFallbackTickets(projectDetails: string, count: number): AgenticTicket[] {
  const normalized = String(projectDetails || "").trim();
  const seeds = normalized
    .split(/\.|\n|;/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, count);

  const items: AgenticTicket[] = [];
  for (let i = 0; i < count; i += 1) {
    const seed = seeds[i] || `Deliver sprint objective ${i + 1}`;
    items.push({
      id: `fallback-${i + 1}`,
      title: seed.length > 80 ? `${seed.slice(0, 77)}...` : seed,
      description: `Fallback demo task generated from sprint description.\n\nContext: ${normalized.slice(0, 320)}`,
      labels: ["demo", "fallback"],
      story_points: i % 3 === 0 ? 5 : i % 2 === 0 ? 3 : 2,
      priority: i < 2 ? "P1" : "P2",
      required_skills: [],
    });
  }

  return items;
}

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

async function gatewayFetchJson<T>(
  token: string,
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<{ ok: boolean; status: number; data: T | null; raw: unknown }> {
  const base = getApiGatewayBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const timeoutMs = Number.isFinite(Number(init?.timeoutMs))
    ? Math.max(1000, Number(init?.timeoutMs))
    : DEFAULT_UPSTREAM_TIMEOUT_MS;
  const requestInit = Object.fromEntries(
    Object.entries(init || {}).filter(([key]) => key !== "timeoutMs")
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(url, {
      ...requestInit,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(requestInit?.body ? { "Content-Type": "application/json" } : {}),
        ...(requestInit?.headers || {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const detail = err instanceof Error ? err.message : String(err);
    const timedOut = /abort/i.test(detail);
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      data: null,
      raw: {
        error: timedOut ? "Upstream timeout" : "Upstream request failed",
        detail,
        path,
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }

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

  const minTickets = Math.max(1, Math.min(MAX_TICKETS_LIMIT, Math.round(Number(body?.minTickets ?? DEFAULT_MIN_TICKETS) || DEFAULT_MIN_TICKETS)));
  const maxTickets = Math.max(minTickets, Math.min(MAX_TICKETS_LIMIT, Math.round(Number(body?.maxTickets ?? minTickets) || minTickets)));
  const mirrorToGithub = body?.mirrorToGithub !== false;

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

  const assignableDevelopers = devItems
    .map((d) => ({
      id: String(d.id || ""),
      currentLoad: Number.isFinite(Number(d.currentLoad)) ? Number(d.currentLoad) : 0,
      maxCapacity: Number.isFinite(Number(d.maxCapacity)) ? Number(d.maxCapacity) : 0,
    }))
    .filter((d) => d.id)
    .sort((a, b) => (b.maxCapacity - b.currentLoad) - (a.maxCapacity - a.currentLoad));

  // Ask AI service (via gateway) to generate tickets + plan assignments
  const aiPayload = {
    sprint_name: sprintName,
    project_details: projectDetails,
    developers,
    constraints: {},
    max_tickets: maxTickets,
  };

  const aiResp = await gatewayFetchJson<AgenticBuildResponse>(token, `/api/v1/ai/agentic/sprint-build`, {
    method: "POST",
    body: JSON.stringify(aiPayload),
    timeoutMs: 60000,
  });
  let warning: string | null = null;
  const generatedFromAi = aiResp.ok && Array.isArray(aiResp.data?.generated_tickets) ? aiResp.data.generated_tickets : [];
  const generated = generatedFromAi.length ? generatedFromAi : buildFallbackTickets(projectDetails, maxTickets);
  const selectedIdsRaw = aiResp.ok && Array.isArray(aiResp.data?.selected_ticket_ids) ? aiResp.data.selected_ticket_ids : [];

  if (!aiResp.ok) {
    const raw = aiResp.raw as Record<string, unknown> | null;
    const upstreamError =
      (typeof raw?.error === "string" && raw.error) ||
      (typeof raw?.detail === "string" && raw.detail) ||
      (typeof raw?.message === "string" && raw.message) ||
      "Agentic sprint build failed";
    warning = `AI planner unavailable (${upstreamError}). Used fallback tasks for demo continuity.`;
  }

  if (!generated.length) {
    return NextResponse.json(
      {
        error: "AI did not generate any tickets. Try more specific project details and rerun.",
        upstream: aiResp.ok ? aiResp.data : aiResp.raw,
      },
      { status: 422 }
    );
  }

  const fallbackSelectedIds = generated
    .slice(0, maxTickets)
    .map((t) => String(t.id || ""))
    .filter(Boolean);

  const selectedIds = (selectedIdsRaw.length ? selectedIdsRaw : fallbackSelectedIds)
    .map((id) => String(id || ""))
    .filter(Boolean);

  const uniqueSelected = Array.from(new Set(selectedIds));
  if (uniqueSelected.length < minTickets) {
    for (const t of generated) {
      const tid = String(t.id || "").trim();
      if (!tid || uniqueSelected.includes(tid)) continue;
      uniqueSelected.push(tid);
      if (uniqueSelected.length >= minTickets) break;
    }
  }

  if (!uniqueSelected.length) {
    return NextResponse.json(
      {
        error: "AI generated tickets but none had usable IDs for task creation.",
        upstream: aiResp.ok ? aiResp.data : aiResp.raw,
      },
      { status: 422 }
    );
  }

  if (uniqueSelected.length < minTickets) {
    return NextResponse.json(
      {
        error: `AI generated ${uniqueSelected.length} usable tasks, but at least ${minTickets} are required. Please provide a richer sprint description and retry.`,
        upstream: aiResp.ok ? aiResp.data : aiResp.raw,
      },
      { status: 422 }
    );
  }

  const byId = new Map<string, AgenticTicket>(generated.map((t) => [String(t.id || ""), t]));

  const createdTasks: Array<Record<string, unknown>> = [];
  const ticketIdToTaskId = new Map<string, string>();
  const taskTicketMeta = new Map<string, AgenticTicket>();

  for (const ticketId of uniqueSelected.slice(0, maxTickets)) {
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

    if (createdTaskId) {
      ticketIdToTaskId.set(String(ticketId), createdTaskId);
      taskTicketMeta.set(createdTaskId, t);
    }
    createdTasks.push((createdTask as Record<string, unknown>) || taskCreateBody);
  }

  const assignments = Array.isArray(aiResp.data?.final_plan?.assignments) ? aiResp.data.final_plan.assignments : [];
  const assignmentResults: Array<Record<string, unknown>> = [];
  const assignedTaskIds = new Set<string>();
  const assignedDeveloperByTaskId = new Map<string, string>();

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
    if (assignResp.ok) {
      assignedTaskIds.add(taskId);
      assignedDeveloperByTaskId.set(taskId, developerId);
    }
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

  // Fallback: if AI did not provide assignment plan, auto-assign created tasks via assignment engine.
  if (!assignments.length) {
    for (const task of createdTasks) {
      const taskId = String((task as { id?: unknown }).id || "");
      if (!taskId || assignedTaskIds.has(taskId)) continue;

      const src = taskTicketMeta.get(taskId);
      const storyPoints = Number.isFinite(Number(src?.story_points)) ? Math.max(0, Math.round(Number(src?.story_points))) : 3;
      const techTags = (Array.isArray(src?.required_skills) ? src.required_skills : []).map(String);

      const autoAssignResp = await gatewayFetchJson<Record<string, unknown>>(token, `/api/v1/assignment/assign`, {
        method: "POST",
        body: JSON.stringify({
          taskId,
          sprintId,
          techTags,
          storyPoints,
          priority: priorityToGatewayPriority(src?.priority),
        }),
      });

      const autoAssigned = autoAssignResp.ok && ((autoAssignResp.data as { assigned?: unknown } | null)?.assigned !== false);
      const autoReason =
        (autoAssignResp.raw as { reason?: unknown; error?: unknown; suggestion?: unknown } | null)?.reason ||
        (autoAssignResp.raw as { error?: unknown } | null)?.error ||
        (autoAssignResp.raw as { suggestion?: unknown } | null)?.suggestion ||
        null;

      let explicitAssigned = false;
      let explicitResp: { ok: boolean; status: number; raw: unknown } | null = null;
      if (!autoAssigned && assignableDevelopers.length) {
        const explicitDeveloperId = assignableDevelopers[0].id;
        const resp = await gatewayFetchJson<Record<string, unknown>>(token, `/api/v1/assignment/assign-explicit`, {
          method: "POST",
          body: JSON.stringify({
            taskId,
            sprintId,
            developerId: explicitDeveloperId,
            reason: "Fallback explicit assignment from agentic builder",
          }),
        });
        explicitResp = { ok: resp.ok, status: resp.status, raw: resp.raw };
        explicitAssigned = resp.ok;
      }

      const finalOk = autoAssigned || explicitAssigned;

      assignmentResults.push({
        ticketId: null,
        taskId,
        developerId: explicitAssigned ? assignableDevelopers[0].id : null,
        mode: explicitAssigned ? "fallback-explicit" : "fallback-auto",
        ok: finalOk,
        status: explicitResp?.status ?? autoAssignResp.status,
        reason: autoReason,
        data: {
          auto: autoAssignResp.raw as unknown,
          explicit: explicitResp?.raw ?? null,
        },
      });
      if (finalOk) assignedTaskIds.add(taskId);
      if (finalOk && explicitAssigned) assignedDeveloperByTaskId.set(taskId, assignableDevelopers[0].id);
    }
  }

  const githubIssueResults: Array<Record<string, unknown>> = [];
  if (mirrorToGithub) {
    const issueTasks = createdTasks.map(async (task) => {
      const taskId = String((task as { id?: unknown }).id || "");
      const title = String((task as { title?: unknown }).title || "").trim();
      if (!taskId || !title) return null;

      const description = String((task as { description?: unknown }).description || "").trim();
      const priority = String((task as { priority?: unknown }).priority || "medium").trim();
      const storyPoints = Number((task as { story_points?: unknown; storyPoints?: unknown }).story_points ?? (task as { storyPoints?: unknown }).storyPoints ?? 0);
      const developerId = assignedDeveloperByTaskId.get(taskId) || null;

      const issueBody = [
        description || "AI-generated sprint task.",
        "",
        `Dashboard Task ID: ${taskId}`,
        `Sprint: ${sprintName}`,
        `Priority: ${priority}`,
        `Story Points: ${Number.isFinite(storyPoints) ? Math.max(0, Math.round(storyPoints)) : 0}`,
      ].join("\n");

      const issueResp = await gatewayFetchJson<GatewayCreateGithubIssueResponse>(token, `/api/v1/github/issues`, {
        method: "POST",
        body: JSON.stringify({
          projectId,
          taskId,
          title,
          body: issueBody,
          labels: ["sprint-plan", "ai-generated", `priority:${priority || "medium"}`],
          developerId,
        }),
        timeoutMs: 12000,
      });

      return {
        taskId,
        ok: issueResp.ok,
        status: issueResp.status,
        issue: issueResp.data?.issue || null,
        upstream: issueResp.raw as unknown,
      };
    });

    const issueResults = await Promise.allSettled(issueTasks);
    for (const result of issueResults) {
      if (result.status === "fulfilled" && result.value) {
        githubIssueResults.push(result.value);
      }
    }

    const mirroredCount = githubIssueResults.filter((r) => Boolean(r.ok)).length;
    if (!mirroredCount) {
      warning = warning
        ? `${warning} GitHub mirroring failed for all tasks.`
        : "GitHub mirroring failed for all tasks. Tasks were still created and assigned.";
    }
  }

  return NextResponse.json(
    {
      sprintId,
      projectId,
      sprintName,
      warning,
      agentic: {
        sprintGoal: aiResp.ok ? aiResp.data?.sprint_goal || null : null,
        selectedTicketIds: uniqueSelected,
        selectionMode: aiResp.ok && selectedIdsRaw.length ? "ai" : "fallback-generated",
        finalPlan: aiResp.ok ? aiResp.data?.final_plan || null : null,
        risks: aiResp.ok ? aiResp.data?.final_plan?.risks || [] : [],
        summary: aiResp.ok ? aiResp.data?.final_plan?.summary || null : null,
      },
      createdTasks,
      assignmentResults,
      githubIssueResults,
      transcript: aiResp.ok ? aiResp.data?.transcript || [] : [],
    },
    { status: 200 }
  );
}
