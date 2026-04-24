import { Pool } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { inngest } from "../client";

type EventBase = { orgId: string; projectId: string };

type IssueOpenedData = EventBase & {
  issueNumber: number;
  title: string;
  body?: string;
  labels?: string[];
  repoFullName: string;
};

type PrOpenedData = EventBase & {
  prNumber: number;
  title: string;
  body?: string;
  branchName: string;
  repoFullName: string;
};

type PrMergedData = EventBase & {
  prNumber: number;
  branchName?: string;
  mergedBy?: string;
};

type GithubPushData = EventBase & {
  repoFullName: string;
  ref?: string;
  before?: string;
  after?: string;
  pusher?: string;
  commits?: Array<{
    id?: string;
    message?: string;
    url?: string;
    timestamp?: string;
    author?: string;
  }>;
};

type TaskUpdatedData = EventBase & {
  taskId: string;
  sprintId?: string;
  title?: string;
  previousStatus?: string;
  status?: string;
  priority?: string;
  storyPoints?: number;
  assigneeId?: string | null;
  changedFields?: string[];
};

type MeetingCompletedData = {
  orgId?: string | null;
  projectId?: string | null;
  sprintId?: string | null;
  meetingId?: string;
  meetingType?: string | null;
  title?: string | null;
  source?: string | null;
};

type MeetingTaskCreatedData = EventBase & {
  sprintId?: string;
  meetingId?: string;
  taskId?: string;
  title?: string;
  assigneeId?: string | null;
  priority?: string | null;
  storyPoints?: number;
};

const OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const VECTOR_DIMENSIONS = Number(process.env.VECTOR_DIMENSIONS || "1536");
const DAILY_CLEANUP_CRON = "0 8 * * *";
const MONITORING_CRON = "*/30 * * * *";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

let universalPool: Pool | null = null;
const tenantPools = new Map<string, Pool>();

function getUniversalPool(): Pool {
  if (universalPool) return universalPool;
  const connectionString = process.env.UNIVERSAL_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing UNIVERSAL_DATABASE_URL or DATABASE_URL");
  universalPool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  return universalPool;
}

async function getTenantPool(orgId: string): Promise<Pool> {
  const key = String(orgId || "").trim();
  if (!key) throw new Error("Missing orgId");
  const cached = tenantPools.get(key);
  if (cached) return cached;
  const resp = await getUniversalPool().query(
    "SELECT db_connection_string FROM organizations WHERE id = $1 LIMIT 1",
    [key]
  );
  const conn = String(resp.rows[0]?.db_connection_string || "").trim();
  if (!conn) throw new Error("Organization DB not provisioned");
  const pool = new Pool({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  tenantPools.set(key, pool);
  return pool;
}

async function ensureAgentActionsTable(orgPool: Pool): Promise<void> {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS agent_actions (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      project_id TEXT,
      user_id TEXT,
      action_name TEXT,
      action TEXT,
      entity_type TEXT,
      entity_id TEXT,
      input JSONB DEFAULT '{}'::jsonb,
      payload JSONB DEFAULT '{}'::jsonb,
      result JSONB DEFAULT '{}'::jsonb,
      status TEXT DEFAULT 'completed',
      source TEXT DEFAULT 'task_factory',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
  await orgPool.query("ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS user_id TEXT");
  await orgPool.query("ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS action_name TEXT");
  await orgPool.query("ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS action TEXT");
  await orgPool.query("ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS entity_type TEXT");
  await orgPool.query("ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS entity_id TEXT");
  await orgPool.query("ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS input JSONB DEFAULT '{}'::jsonb");
  await orgPool.query("ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb");
  await orgPool.query("ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'task_factory'");
}

async function ensureAgentRunsTable(orgPool: Pool): Promise<void> {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS agent_runs (
      agent_name TEXT PRIMARY KEY,
      last_run TIMESTAMPTZ,
      next_run TIMESTAMPTZ,
      last_status TEXT,
      actions_today INTEGER DEFAULT 0,
      last_result JSONB
    )`
  );
  await orgPool.query("ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS next_run TIMESTAMPTZ");
  await orgPool.query("ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS actions_today INTEGER DEFAULT 0");
  await orgPool.query("ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS last_result JSONB");
}

async function ensureAgentConfigsTable(orgPool: Pool): Promise<void> {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS agent_configs (
      id TEXT PRIMARY KEY,
      agent_type TEXT NOT NULL,
      project_id TEXT NOT NULL,
      trigger_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      autonomy_level INTEGER NOT NULL DEFAULT 2,
      constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
      context_memo TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (agent_type, project_id)
    )`
  );
}

async function ensureProjectAutomationPoliciesTable(orgPool: Pool): Promise<void> {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS project_automation_policies (
      project_id TEXT PRIMARY KEY,
      create_from_issue BOOLEAN NOT NULL DEFAULT TRUE,
      create_from_pr BOOLEAN NOT NULL DEFAULT TRUE,
      auto_assign BOOLEAN NOT NULL DEFAULT TRUE,
      monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      guarded_mode BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
}

type ProjectAutomationPolicy = {
  createFromIssue: boolean;
  createFromPr: boolean;
  autoAssign: boolean;
  monitoringEnabled: boolean;
  guardedMode: boolean;
};

async function getProjectPolicy(orgPool: Pool, projectId: string): Promise<ProjectAutomationPolicy> {
  await ensureProjectAutomationPoliciesTable(orgPool);
  await ensureAgentConfigsTable(orgPool);
  const defaults: ProjectAutomationPolicy = {
    createFromIssue: true,
    createFromPr: true,
    autoAssign: true,
    monitoringEnabled: true,
    guardedMode: false,
  };
  const policyResp = await orgPool.query(
    `SELECT create_from_issue, create_from_pr, auto_assign, monitoring_enabled, guarded_mode
     FROM project_automation_policies
     WHERE project_id = $1
     LIMIT 1`,
    [String(projectId)]
  );
  const policyRow = policyResp.rows[0];
  if (policyRow) {
    return {
      createFromIssue: Boolean(policyRow.create_from_issue),
      createFromPr: Boolean(policyRow.create_from_pr),
      autoAssign: Boolean(policyRow.auto_assign),
      monitoringEnabled: Boolean(policyRow.monitoring_enabled),
      guardedMode: Boolean(policyRow.guarded_mode),
    };
  }

  const resp = await orgPool.query(
    `SELECT trigger_settings, constraints, autonomy_level
     FROM agent_configs
     WHERE project_id = $1
       AND agent_type = 'task-factory'
     LIMIT 1`,
    [String(projectId)]
  );
  const row = resp.rows[0];
  if (!row) return defaults;
  const triggers = (row.trigger_settings || {}) as Record<string, unknown>;
  const constraints = (row.constraints || {}) as Record<string, unknown>;
  const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  return {
    createFromIssue: bool(constraints.createFromIssue, defaults.createFromIssue),
    createFromPr: bool(constraints.createFromPr, defaults.createFromPr),
    autoAssign: bool(constraints.autoAssign, defaults.autoAssign),
    monitoringEnabled: bool(triggers.monitoringEnabled, defaults.monitoringEnabled),
    guardedMode: Number(row.autonomy_level || 2) <= 1,
  };
}

async function logAction(
  orgPool: Pool,
  input: {
    projectId?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    payload?: Record<string, unknown>;
    result?: Record<string, unknown>;
    status?: string;
  }
): Promise<void> {
  await ensureAgentActionsTable(orgPool);
  await orgPool.query(
    `INSERT INTO agent_actions (id, project_id, action_name, action, entity_type, entity_id, input, payload, result, status, source)
     VALUES ($1,$2,$3,$3,$4,$5,$6::jsonb,$6::jsonb,$7::jsonb,$8,$9)`,
    [
      randomUUID(),
      input.projectId ? String(input.projectId) : null,
      String(input.action),
      input.entityType ? String(input.entityType) : null,
      input.entityId ? String(input.entityId) : null,
      JSON.stringify(input.payload || {}),
      JSON.stringify(input.result || {}),
      String(input.status || "completed"),
      "task_factory",
    ]
  );
}

async function trackRun(orgPool: Pool, agentName: string, status: string, nextRun?: string): Promise<void> {
  await ensureAgentRunsTable(orgPool);

  const updateResp = await orgPool.query(
    `UPDATE agent_runs
     SET last_run = NOW(),
         next_run = COALESCE($2::timestamptz, next_run),
         last_status = $3,
         actions_today = CASE
           WHEN DATE(last_run) = CURRENT_DATE THEN COALESCE(actions_today, 0) + 1
           ELSE 1
         END
     WHERE agent_name = $1`,
    [agentName, nextRun || null, status]
  );

  if (!updateResp.rowCount) {
    await orgPool.query(
      `INSERT INTO agent_runs (agent_name, last_run, next_run, last_status, actions_today)
       VALUES ($1, NOW(), $2::timestamptz, $3, 1)`,
      [agentName, nextRun || null, status]
    );
  }
}

function classifyPriority(title: string, body: string, labels: string[]): string {
  const text = `${title} ${body} ${(labels || []).join(" ")}`.toLowerCase();
  if (["crash", "down", "broken", "critical", "urgent", "production"].some((k) => text.includes(k))) return "critical";
  if (["bug", "error", "fix", "broken"].some((k) => text.includes(k))) return "high";
  if (["feature", "add", "improve", "enhance"].some((k) => text.includes(k))) return "medium";
  return "low";
}

function classifyType(labels: string[]): string {
  const set = new Set((labels || []).map((x) => String(x).toLowerCase()));
  if (set.has("bug")) return "bug";
  if (set.has("enhancement") || set.has("feature")) return "feature";
  if (set.has("documentation")) return "chore";
  return "task";
}

function inferTechTags(title: string, body: string): string[] {
  const text = `${title} ${body}`.toLowerCase();
  const tags: string[] = [];
  const map: Array<[string, string]> = [
    ["frontend", "react"],
    ["ui", "react"],
    ["next", "nextjs"],
    ["api", "backend"],
    ["backend", "backend"],
    ["database", "sql"],
    ["postgres", "sql"],
    ["auth", "security"],
    ["security", "security"],
    ["devops", "devops"],
    ["docker", "devops"],
    ["test", "testing"],
    ["jest", "testing"],
  ];
  for (const [needle, tag] of map) {
    if (text.includes(needle) && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function inferStoryPoints(priority: string): number {
  if (priority === "critical") return 8;
  if (priority === "high") return 5;
  if (priority === "medium") return 3;
  return 2;
}

async function generateTaskDescription(input: {
  title: string;
  rawBody?: string;
  issueNumber?: number;
  prNumber?: number;
  branchName?: string;
  techTags?: string[];
  priority?: string;
  type?: string;
  commitMessage?: string;
  commitAuthor?: string;
  commitUrl?: string;
  similarTasks?: Array<{ sourceType: string; content: string }>;
}): Promise<string> {
  if (!GROQ_API_KEY) {
    return buildBasicDescription(input);
  }

  try {
    const context = buildContextForLLM(input);
    const systemPrompt = `You are a technical task management assistant. Generate a clear, structured task description.
Focus on: what needs to be done, why it matters, technical context, and dependencies.
Keep it concise (3-5 sentences max) but comprehensive.
Format: Clear problem statement, then bullet points for requirements if needed.`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context },
        ],
      }),
    });

    if (!response.ok) {
      console.error("Groq LLM failed, falling back to basic description", response.status);
      return buildBasicDescription(input);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const generated = data.choices?.[0]?.message?.content?.trim?.();
    if (generated) {
      return generated;
    }
    return buildBasicDescription(input);
  } catch (error) {
    console.error("LLM description generation failed:", error);
    return buildBasicDescription(input);
  }
}

function buildContextForLLM(input: {
  title: string;
  rawBody?: string;
  issueNumber?: number;
  prNumber?: number;
  branchName?: string;
  techTags?: string[];
  priority?: string;
  type?: string;
  commitMessage?: string;
  commitAuthor?: string;
  commitUrl?: string;
  similarTasks?: Array<{ sourceType: string; content: string }>;
}): string {
  const parts: string[] = [];

  if (input.issueNumber) {
    parts.push(`GitHub Issue #${input.issueNumber}`);
  } else if (input.prNumber) {
    parts.push(`GitHub PR #${input.prNumber}`);
  } else if (input.commitMessage) {
    parts.push(`Commit: ${input.commitMessage}`);
  }

  parts.push(`Title: ${input.title}`);

  if (input.rawBody) {
    parts.push(`Description: ${input.rawBody.slice(0, 500)}`);
  }

  if (input.techTags?.length) {
    parts.push(`Tech stack: ${input.techTags.join(", ")}`);
  }

  if (input.priority) {
    parts.push(`Priority: ${input.priority}`);
  }

  if (input.type) {
    parts.push(`Type: ${input.type}`);
  }

  if (input.similarTasks?.length) {
    parts.push(
      `Similar existing tasks:\n${input.similarTasks
        .slice(0, 2)
        .map((t) => `- [${t.sourceType}] ${String(t.content || "").slice(0, 100)}`)
        .join("\n")}`
    );
  }

  parts.push(
    "Generate a task description that: (1) explains what needs to be done, (2) includes relevant context, (3) lists technical requirements/tech stack, (4) identifies dependencies."
  );

  return parts.filter(Boolean).join("\n");
}

function buildBasicDescription(input: {
  title: string;
  rawBody?: string;
  issueNumber?: number;
  prNumber?: number;
  branchName?: string;
  techTags?: string[];
  priority?: string;
  commitMessage?: string;
  commitAuthor?: string;
  similarTasks?: Array<{ sourceType: string; content: string }>;
}): string {
  const lines: string[] = [];

  if (input.rawBody) {
    lines.push(String(input.rawBody).trim());
  } else {
    lines.push(
      `Task from ${input.issueNumber ? `issue #${input.issueNumber}` : input.prNumber ? `PR #${input.prNumber}` : "GitHub"}: ${input.title}`
    );
  }

  if (input.techTags?.length) {
    lines.push(`Tech tags: ${input.techTags.join(", ")}`);
  }

  if (input.priority) {
    lines.push(`Priority: ${input.priority}`);
  }

  if (input.similarTasks?.length) {
    lines.push("\nRelated tasks:");
    for (const task of input.similarTasks.slice(0, 2)) {
      const snippet = String(task.content || "").replace(/\s+/g, " ").slice(0, 100);
      lines.push(`- [${task.sourceType}] ${snippet}`);
    }
  }

  return lines.filter(Boolean).join("\n");
}

async function embedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const input = String(text || "").trim().slice(0, 8000);
  if (!input) return null;
  const resp = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
  });
  if (!resp.ok) return null;
  const payload = (await resp.json()) as { data?: Array<{ embedding?: number[] }> };
  const vec = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== VECTOR_DIMENSIONS) return null;
  return vec.map((v) => Number(v));
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => Number(v).toFixed(8)).join(",")}]`;
}

async function searchSimilar(
  orgPool: Pool,
  query: string,
  projectId: string
): Promise<Array<{ sourceId: string; sourceType: string; similarity: number; content: string }>> {
  const vector = await embedText(query);
  if (!vector) return [];
  // Convert cosine distance to similarity so deduplication thresholds remain human-readable.
  const resp = await getUniversalPool().query(
    `SELECT source_id, source_type, content, 1 - (vector <=> $1::vector) AS similarity
     FROM embeddings
     WHERE project_id = $2
       AND source_type = ANY($3::text[])
     ORDER BY vector <=> $1::vector
     LIMIT 6`,
    [toVectorLiteral(vector), String(projectId), ["task", "issue", "pr", "commit", "readme", "sprint", "page"]]
  );
  return resp.rows.map((r) => ({
    sourceId: String(r.source_id),
    sourceType: String(r.source_type || "unknown"),
    similarity: Number(r.similarity || 0),
    content: String(r.content || ""),
  }));
}

function buildRagDescription(base: string, refs: Array<{ sourceType: string; content: string }>, requiredSkills: string[]): string {
  const lines = [String(base || "").trim()];
  if (requiredSkills.length) {
    lines.push(`Required skills: ${requiredSkills.join(", ")}`);
  }
  if (refs.length) {
    lines.push("Context references:");
    for (const ref of refs.slice(0, 3)) {
      const snippet = String(ref.content || "").replace(/\s+/g, " ").slice(0, 180);
      lines.push(`- [${String(ref.sourceType || "source")}] ${snippet}`);
    }
  }
  return lines.filter(Boolean).join("\n");
}

async function upsertTaskEmbedding(taskId: string, code: string, title: string, description: string, projectId: string): Promise<void> {
  const text = `Task ${code}: ${title}\n${description || ""}`.trim();
  const vector = await embedText(text);
  if (!vector) return;
  await getUniversalPool().query(
    `INSERT INTO embeddings (id, source_type, source_id, project_id, content, vector, metadata, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::vector,$7::jsonb,NOW())
     ON CONFLICT (source_id, source_type)
     DO UPDATE SET
       id = EXCLUDED.id,
       project_id = EXCLUDED.project_id,
       content = EXCLUDED.content,
       vector = EXCLUDED.vector,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()`,
    [
      `task:${taskId}`,
      "task",
      String(taskId),
      String(projectId),
      text,
      toVectorLiteral(vector),
      JSON.stringify({ code }),
    ]
  );
}

async function resolveSprintId(orgPool: Pool, projectId: string): Promise<string | null> {
  const active = await orgPool.query(
    `SELECT id FROM sprints WHERE project_id = $1 AND status = 'active' ORDER BY start_date DESC NULLS LAST LIMIT 1`,
    [String(projectId)]
  );
  if (active.rows[0]?.id) return String(active.rows[0].id);
  const plan = await orgPool.query(
    `SELECT id FROM sprints WHERE project_id = $1 AND status = 'planning' ORDER BY start_date DESC NULLS LAST LIMIT 1`,
    [String(projectId)]
  );
  return plan.rows[0]?.id ? String(plan.rows[0].id) : null;
}

async function nextTaskCode(orgPool: Pool): Promise<string> {
  const resp = await orgPool.query(
    `SELECT COALESCE(MAX(CASE WHEN jira_issue_key ~ '^SCRUM-[0-9]+$' THEN split_part(jira_issue_key, '-', 2)::int END), 0) + 1 AS next_n
     FROM tasks`
  );
  return `SCRUM-${Number(resp.rows[0]?.next_n || 1)}`;
}

async function createTaskFromSource(
  orgPool: Pool,
  input: {
    projectId: string;
    title: string;
    description: string;
    priority: string;
    type: string;
    techTags?: string[];
    storyPoints?: number;
    requiredSkills?: string[];
    ragRefs?: Array<{ sourceType: string; content: string }>;
    issueNumber?: number;
    issueUrl?: string;
    prNumber?: number;
    prUrl?: string;
  }
): Promise<{ taskId: string; code: string; sprintId: string }> {
  const sprintId = await resolveSprintId(orgPool, input.projectId);
  if (!sprintId) throw new Error("No active/planning sprint found for project");
  const code = await nextTaskCode(orgPool);
  const requiredSkills = Array.isArray(input.requiredSkills) ? input.requiredSkills : [];
  const finalDescription = buildRagDescription(String(input.description || ""), input.ragRefs || [], requiredSkills);

  const resp = await orgPool.query(
    `INSERT INTO tasks (
       sprint_id, project_id, title, description, type, priority, status,
       tech_tags, story_points,
       jira_issue_key, github_issue_number, github_issue_url, github_pr_number, github_pr_url
     ) VALUES ($1,$2,$3,$4,$5,$6,'todo',$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      sprintId,
      String(input.projectId),
      String(input.title),
      finalDescription || null,
      String(input.type || "task"),
      String(input.priority || "medium"),
      input.techTags || [],
      Number(input.storyPoints || 0),
      code,
      input.issueNumber || null,
      input.issueUrl || null,
      input.prNumber || null,
      input.prUrl || null,
    ]
  );
  return { taskId: String(resp.rows[0].id), code, sprintId };
}

type AssignmentCandidate = {
  id: string;
  member_id: string;
  full_name: string;
  tech_stack: string[];
  merit_score: number;
  assignment_weight: number;
  current_sprint_load: number;
  max_sprint_capacity: number;
};

function rankCandidate(c: AssignmentCandidate, techTags: string[]): number {
  const tags = new Set((techTags || []).map((t) => String(t).toLowerCase()));
  const stack = new Set((c.tech_stack || []).map((t) => String(t).toLowerCase()));
  const match = tags.size ? [...tags].filter((t) => stack.has(t)).length / tags.size : 0.5;
  const cap = Math.max(1, Number(c.max_sprint_capacity || 1));
  const loadScore = 1 - Math.min(1, Number(c.current_sprint_load || 0) / cap);
  const merit = Math.max(0, Number(c.merit_score || 0) * Number(c.assignment_weight || 1));
  return Math.round((match * 40 + loadScore * 40 + merit * 20) * 100) / 100;
}

async function autoAssignTask(
  orgPool: Pool,
  taskId: string,
  projectId: string,
  options?: { forceReassign?: boolean }
): Promise<{ assigned: boolean; developerId?: string }> {
  const taskResp = await orgPool.query(
    `SELECT id, sprint_id, story_points, tech_tags, assignee_id
     FROM tasks
     WHERE id = $1 AND project_id = $2
     LIMIT 1`,
    [String(taskId), String(projectId)]
  );
  const task = taskResp.rows[0];
  if (!task || !task.sprint_id) return { assigned: false };
  const forceReassign = Boolean(options?.forceReassign);
  if (task.assignee_id && !forceReassign) return { assigned: false };

  const candidatesResp = await orgPool.query(
    `SELECT dp.id, dp.member_id, tm.full_name, dp.tech_stack, dp.merit_score, dp.assignment_weight,
            dp.current_sprint_load, dp.max_sprint_capacity
     FROM developer_profiles dp
     JOIN team_members tm ON tm.id = dp.member_id
     JOIN project_members pm ON pm.member_id = tm.id
     WHERE pm.project_id = $1
       AND tm.is_active = TRUE
       AND dp.availability_status = 'available'`,
    [String(projectId)]
  );
  const candidates = (candidatesResp.rows || []) as AssignmentCandidate[];
  if (!candidates.length) return { assigned: false };

  const points = Number(task.story_points || 0);
  const techTags = Array.isArray(task.tech_tags) ? task.tech_tags.map((x: unknown) => String(x)) : [];
  const eligible = candidates
    .filter((c) => Number(c.current_sprint_load || 0) + points <= Number(c.max_sprint_capacity || 0))
    .filter((c) => forceReassign ? String(c.id) !== String(task.assignee_id || "") : true);
  if (!eligible.length) return { assigned: false };
  const winner = [...eligible].sort((a, b) => rankCandidate(b, techTags) - rankCandidate(a, techTags))[0];

  await orgPool.query("BEGIN");
  try {
    await orgPool.query(
      `UPDATE tasks
       SET assignee_id = $1, assigned_by = 'ai', assigned_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [String(winner.id), String(taskId)]
    );
    if (task.assignee_id && forceReassign) {
      await orgPool.query(
        `UPDATE developer_profiles
         SET current_sprint_load = GREATEST(0, current_sprint_load - $2), updated_at = NOW()
         WHERE id = $1`,
        [String(task.assignee_id), points]
      );
    }
    await orgPool.query(
      `UPDATE developer_profiles
       SET current_sprint_load = current_sprint_load + $2, updated_at = NOW()
       WHERE id = $1`,
      [String(winner.id), points]
    );
    await orgPool.query(
      `INSERT INTO assignment_log (task_id, developer_id, assigned_by, assignment_reason, total_candidates)
       VALUES ($1,$2,'ai','Auto-assigned by task factory', $3)`,
      [String(taskId), String(winner.id), Number(eligible.length)]
    );
    await orgPool.query("COMMIT");
  } catch (error) {
    try {
      await orgPool.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  }

  return { assigned: true, developerId: String(winner.id) };
}

async function emitTaskCreated(taskId: string, projectId: string, orgId: string): Promise<void> {
  await inngest.send({ name: "task/created", data: { taskId, projectId, orgId } });
}

async function notifyProject(orgPool: Pool, projectId: string, title: string, body: string, taskId?: string): Promise<void> {
  const members = await orgPool.query(
    `SELECT DISTINCT member_id FROM project_members WHERE project_id = $1 AND role IN ('owner','admin','manager')`,
    [String(projectId)]
  );
  for (const row of members.rows) {
    await orgPool.query(
      `INSERT INTO notifications (recipient_member_id, type, title, body, action_url, reference_id, reference_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [String(row.member_id), "task_created", title, body, taskId ? `/tasks/${taskId}` : null, taskId || null, "task"]
    );
  }
}

async function updateSprintCompletedPoints(orgPool: Pool, sprintId: string): Promise<{ completed: number; planned: number; donePercent: number }> {
  const points = await orgPool.query(
    `SELECT
       COALESCE(SUM(story_points) FILTER (WHERE status = 'done'), 0)::int AS completed,
       COALESCE(SUM(story_points), 0)::int AS planned
     FROM tasks
     WHERE sprint_id = $1`,
    [String(sprintId)]
  );
  const completed = Number(points.rows[0]?.completed || 0);
  const planned = Number(points.rows[0]?.planned || 0);
  const donePercent = planned > 0 ? Math.round((completed / planned) * 100) : 0;
  await orgPool.query(
    `UPDATE sprints SET completed_points = $2, updated_at = NOW() WHERE id = $1`,
    [String(sprintId), completed]
  );
  return { completed, planned, donePercent };
}

function extractTaskCode(branchName: string): string | null {
  const match = String(branchName || "").match(/([A-Z]+-\d+)/i);
  return match?.[1] ? String(match[1]).toUpperCase() : null;
}

export const githubIssueToTask = inngest.createFunction(
  { id: "github-issue-to-task", name: "GitHub Issue to Task" },
  { event: "github/issue.opened" },
  async ({ event, step }) => {
    const data = event.data as IssueOpenedData;
    const orgPool = await getTenantPool(data.orgId);
    await trackRun(orgPool, "github-issue-to-task", "running");

    try {
      const policy = await step.run("read-policy", async () => getProjectPolicy(orgPool, data.projectId));
      if (!policy.createFromIssue) {
        await logAction(orgPool, {
          projectId: data.projectId,
          action: "issue_auto_create_disabled",
          entityType: "issue",
          entityId: String(data.issueNumber),
          payload: { source: "github" },
        });
        await trackRun(orgPool, "github-issue-to-task", "completed");
        return { skipped: true, reason: "policy_disabled" };
      }

      const duplicates = await step.run("deduplicate", async () => searchSimilar(orgPool, data.title, data.projectId));
  // Keep this strict to avoid merging separate issues that share broad wording.
      const duplicate = duplicates.find((r) => r.similarity > 0.85);
      if (duplicate) {
        await logAction(orgPool, {
          projectId: data.projectId,
          action: "duplicate_skipped",
          entityType: "task",
          entityId: duplicate.sourceId,
          payload: { issueNumber: data.issueNumber, title: data.title },
          result: { similarity: duplicate.similarity },
        });
        await trackRun(orgPool, "github-issue-to-task", "completed");
        return { skipped: true, matchedTaskId: duplicate.sourceId };
      }

      const labels = Array.isArray(data.labels) ? data.labels : [];
      const priority = classifyPriority(data.title, data.body || "", labels);
      const type = classifyType(labels);
      const techTags = inferTechTags(data.title, data.body || "");
      const storyPoints = inferStoryPoints(priority);
      const ragRefs = duplicates.filter((r) => r.similarity >= 0.55).slice(0, 3);
      const issueUrl = `https://github.com/${data.repoFullName}/issues/${Number(data.issueNumber)}`;

      const enhancedDescription = await step.run("generate-description", async () =>
        generateTaskDescription({
          title: data.title,
          rawBody: data.body,
          issueNumber: Number(data.issueNumber),
          techTags,
          priority,
          type,
          similarTasks: ragRefs,
        })
      );

      const created = await step.run("create-task", async () =>
        createTaskFromSource(orgPool, {
          projectId: data.projectId,
          title: data.title,
          description: enhancedDescription,
          priority,
          type,
          techTags,
          storyPoints,
          requiredSkills: techTags,
          ragRefs,
          issueNumber: Number(data.issueNumber),
          issueUrl,
        })
      );

      await step.run("embed-task", async () =>
        upsertTaskEmbedding(created.taskId, created.code, data.title, data.body || "", data.projectId)
      );
      await step.run("fire-assigner", async () => emitTaskCreated(created.taskId, data.projectId, data.orgId));
      await step.run("notify", async () =>
        notifyProject(
          orgPool,
          data.projectId,
          "Task created from GitHub issue",
          `Agent created task ${created.code} from GitHub issue #${Number(data.issueNumber)}`,
          created.taskId
        )
      );

      await logAction(orgPool, {
        projectId: data.projectId,
        action: "task_created",
        entityType: "task",
        entityId: created.taskId,
        payload: { source: "github", issueNumber: data.issueNumber },
        result: { code: created.code },
      });
      await trackRun(orgPool, "github-issue-to-task", "completed");
      return { skipped: false, taskId: created.taskId, code: created.code };
    } catch (error) {
      await logAction(orgPool, {
        projectId: data.projectId,
        action: "task_factory_failed",
        entityType: "issue",
        entityId: String(data.issueNumber),
        payload: { source: "github", title: data.title },
        result: { error: String((error as Error)?.message || error) },
        status: "failed",
      });
      await trackRun(orgPool, "github-issue-to-task", "failed");
      throw error;
    }
  }
);

export const prToTask = inngest.createFunction(
  { id: "pr-to-task", name: "PR to Task" },
  { event: "github/pr.opened" },
  async ({ event }) => {
    const data = event.data as PrOpenedData;
    const orgPool = await getTenantPool(data.orgId);
    await trackRun(orgPool, "pr-to-task", "running");

    try {
      const policy = await getProjectPolicy(orgPool, data.projectId);
      if (!policy.createFromPr) {
        await logAction(orgPool, {
          projectId: data.projectId,
          action: "pr_auto_create_disabled",
          entityType: "pr",
          entityId: String(data.prNumber),
          payload: { source: "github" },
        });
        await trackRun(orgPool, "pr-to-task", "completed");
        return { linked: false, created: false, reason: "policy_disabled" };
      }

      const existing = await orgPool.query(
        `SELECT id FROM tasks WHERE project_id = $1 AND github_pr_number = $2 LIMIT 1`,
        [String(data.projectId), Number(data.prNumber)]
      );
      if (existing.rows[0]?.id) {
        await orgPool.query(
          `UPDATE tasks SET status = 'in_review', updated_at = NOW() WHERE id = $1`,
          [String(existing.rows[0].id)]
        );
        await logAction(orgPool, {
          projectId: data.projectId,
          action: "pr_link_existing",
          entityType: "task",
          entityId: String(existing.rows[0].id),
          payload: { prNumber: data.prNumber },
          result: { status: "in_review" },
        });
        await trackRun(orgPool, "pr-to-task", "completed");
        return { linked: true, updated: true, taskId: String(existing.rows[0].id) };
      }

      const code = extractTaskCode(data.branchName);
      if (code) {
        const linked = await orgPool.query(
          `UPDATE tasks
           SET github_pr_number = $1,
               github_pr_url = COALESCE(github_pr_url, $2),
               status = 'in_review',
               updated_at = NOW()
           WHERE project_id = $3 AND UPPER(jira_issue_key) = UPPER($4)
           RETURNING id`,
          [
            Number(data.prNumber),
            `https://github.com/${data.repoFullName}/pull/${Number(data.prNumber)}`,
            String(data.projectId),
            code,
          ]
        );
        if (linked.rows[0]?.id) {
          await logAction(orgPool, {
            projectId: data.projectId,
            action: "pr_linked_by_branch_code",
            entityType: "task",
            entityId: String(linked.rows[0].id),
            payload: { prNumber: data.prNumber, branchName: data.branchName },
            result: { linked: true },
          });
          await trackRun(orgPool, "pr-to-task", "completed");
          return { linked: true, taskId: String(linked.rows[0].id) };
        }
      }

      const labels: string[] = [];
      const priority = classifyPriority(data.title, data.body || "", labels);
      const type = classifyType(labels);
      const techTags = inferTechTags(data.title, data.body || "");
      const storyPoints = inferStoryPoints(priority);
      const ragRefs = await searchSimilar(orgPool, `${data.title}\n${data.body || ""}`, data.projectId);
      
      const enhancedDescription = await generateTaskDescription({
        title: data.title,
        rawBody: data.body,
        prNumber: Number(data.prNumber),
        branchName: data.branchName,
        techTags,
        priority,
        type,
        similarTasks: ragRefs.filter((r) => r.similarity >= 0.5).slice(0, 3),
      });
      
      const created = await createTaskFromSource(orgPool, {
        projectId: data.projectId,
        title: `Review: ${data.title}`,
        description: enhancedDescription,
        priority,
        type,
        techTags,
        storyPoints,
        requiredSkills: techTags,
        ragRefs: ragRefs.filter((r) => r.similarity >= 0.5).slice(0, 3),
        prNumber: Number(data.prNumber),
        prUrl: `https://github.com/${data.repoFullName}/pull/${Number(data.prNumber)}`,
      });
      await upsertTaskEmbedding(created.taskId, created.code, `Review: ${data.title}`, enhancedDescription, data.projectId);
      await emitTaskCreated(created.taskId, data.projectId, data.orgId);
      await notifyProject(
        orgPool,
        data.projectId,
        "Task created from PR",
        `Agent created task ${created.code} from GitHub PR #${Number(data.prNumber)}`,
        created.taskId
      );
      await logAction(orgPool, {
        projectId: data.projectId,
        action: "task_created_from_pr",
        entityType: "task",
        entityId: created.taskId,
        payload: { prNumber: data.prNumber },
        result: { code: created.code },
      });
      await trackRun(orgPool, "pr-to-task", "completed");
      return { linked: false, created: true, taskId: created.taskId, code: created.code };
    } catch (error) {
      await logAction(orgPool, {
        projectId: data.projectId,
        action: "pr_to_task_failed",
        entityType: "pr",
        entityId: String(data.prNumber),
        payload: { branchName: data.branchName },
        result: { error: String((error as Error)?.message || error) },
        status: "failed",
      });
      await trackRun(orgPool, "pr-to-task", "failed");
      throw error;
    }
  }
);

export const githubPushToTask = inngest.createFunction(
  { id: "github-push-to-task", name: "GitHub Push to Task" },
  { event: "github/push" },
  async ({ event }) => {
    const data = event.data as GithubPushData;
    const orgPool = await getTenantPool(data.orgId);
    await trackRun(orgPool, "github-push-to-task", "running");

    try {
      const policy = await getProjectPolicy(orgPool, data.projectId);
      if (!policy.createFromIssue && !policy.createFromPr) {
        await trackRun(orgPool, "github-push-to-task", "completed");
        return { created: 0, skipped: true, reason: "policy_disabled" };
      }

      const commits = Array.isArray(data.commits) ? data.commits : [];
      const actionable = commits.filter((c) => {
        const m = String(c.message || "").toLowerCase();
        return ["feat", "fix", "refactor", "perf", "security"].some((k) => m.includes(k));
      }).slice(0, 3);

      let createdCount = 0;
      for (const commit of actionable) {
        const message = String(commit.message || "").trim();
        if (!message) continue;
        const duplicates = await searchSimilar(orgPool, message, data.projectId);
        // Commit messages are short/noisy, so use a slightly higher duplicate cutoff.
        if (duplicates.some((d) => d.similarity > 0.86)) {
          continue;
        }

        const priority = classifyPriority(message, "", []);
        const techTags = inferTechTags(message, "");
        
        const enhancedDescription = await generateTaskDescription({
          title: message.slice(0, 120),
          commitMessage: message,
          commitAuthor: commit.author,
          commitUrl: commit.url,
          techTags,
          priority,
          type: "task",
          similarTasks: duplicates.filter((r) => r.similarity >= 0.5).slice(0, 3),
        });
        
        const created = await createTaskFromSource(orgPool, {
          projectId: data.projectId,
          title: `Follow-up: ${message.slice(0, 120)}`,
          description: enhancedDescription,
          priority,
          type: "task",
          techTags,
          requiredSkills: techTags,
          storyPoints: inferStoryPoints(priority),
          ragRefs: duplicates.filter((r) => r.similarity >= 0.5).slice(0, 3),
        });
        await upsertTaskEmbedding(created.taskId, created.code, `Follow-up: ${message}`, enhancedDescription, data.projectId);
        await emitTaskCreated(created.taskId, data.projectId, data.orgId);
        createdCount += 1;
      }

      await logAction(orgPool, {
        projectId: data.projectId,
        action: "tasks_created_from_push",
        entityType: "project",
        entityId: data.projectId,
        payload: { commitCount: commits.length, actionableCount: actionable.length },
        result: { createdCount },
      });
      await trackRun(orgPool, "github-push-to-task", "completed");
      return { created: createdCount };
    } catch (error) {
      await trackRun(orgPool, "github-push-to-task", "failed");
      throw error;
    }
  }
);

export const taskCreatedAutoAssign = inngest.createFunction(
  { id: "task-created-auto-assign", name: "Task Created Auto Assign" },
  { event: "task/created" },
  async ({ event }) => {
    const data = (event.data || {}) as { orgId?: string; projectId?: string; taskId?: string };
    const orgId = String(data.orgId || "").trim();
    const projectId = String(data.projectId || "").trim();
    const taskId = String(data.taskId || "").trim();
    if (!orgId || !projectId || !taskId) return { assigned: false, reason: "missing_fields" };

    const orgPool = await getTenantPool(orgId);
    await trackRun(orgPool, "task-created-auto-assign", "running");
    try {
      const policy = await getProjectPolicy(orgPool, projectId);
      if (!policy.autoAssign || policy.guardedMode) {
        await logAction(orgPool, {
          projectId,
          action: "auto_assign_skipped",
          entityType: "task",
          entityId: taskId,
          payload: { reason: policy.guardedMode ? "guarded_mode" : "policy_disabled" },
        });
        await trackRun(orgPool, "task-created-auto-assign", "completed");
        return { assigned: false };
      }

      const result = await autoAssignTask(orgPool, taskId, projectId);
      await logAction(orgPool, {
        projectId,
        action: result.assigned ? "task_auto_assigned" : "task_auto_assign_no_candidate",
        entityType: "task",
        entityId: taskId,
        result,
      });
      await trackRun(orgPool, "task-created-auto-assign", "completed");
      return result;
    } catch (error) {
      await logAction(orgPool, {
        projectId,
        action: "task_auto_assign_failed",
        entityType: "task",
        entityId: taskId,
        status: "failed",
        result: { error: String((error as Error)?.message || error) },
      });
      await trackRun(orgPool, "task-created-auto-assign", "failed");
      throw error;
    }
  }
);

export const taskUpdatedMonitoring = inngest.createFunction(
  { id: "task-updated-monitoring", name: "Task Updated Monitoring" },
  { event: "task/updated" },
  async ({ event }) => {
    const data = event.data as TaskUpdatedData;
    const orgPool = await getTenantPool(data.orgId);
    await trackRun(orgPool, "task-updated-monitoring", "running");

    try {
      const policy = await getProjectPolicy(orgPool, data.projectId);
      const status = String(data.status || "").toLowerCase();

      if (status === "blocked") {
        await notifyProject(
          orgPool,
          data.projectId,
          "Blocked task detected",
          `Task ${String(data.title || data.taskId)} moved to blocked.`,
          data.taskId
        );

        if (policy.autoAssign && !policy.guardedMode) {
          await autoAssignTask(orgPool, data.taskId, data.projectId, { forceReassign: true });
        }

        await logAction(orgPool, {
          projectId: data.projectId,
          action: "blocked_task_alert",
          entityType: "task",
          entityId: data.taskId,
          payload: { previousStatus: data.previousStatus || null, status: data.status || null },
        });
      }

      await trackRun(orgPool, "task-updated-monitoring", "completed");
      return { monitored: true };
    } catch (error) {
      await trackRun(orgPool, "task-updated-monitoring", "failed");
      throw error;
    }
  }
);

export const customAgentRunObserved = inngest.createFunction(
  { id: "custom-agent-run-observed", name: "Custom Agent Run Observed" },
  { event: "agent/custom.run" },
  async ({ event }) => {
    const data = (event.data || {}) as {
      orgId?: string;
      projectId?: string;
      agentId?: string;
      createdTasks?: number;
      assignedTasks?: number;
    };

    const orgId = String(data.orgId || "").trim();
    const projectId = String(data.projectId || "").trim();
    if (!orgId || !projectId) return { observed: false, reason: "missing_org_or_project" };

    const orgPool = await getTenantPool(orgId);
    await logAction(orgPool, {
      projectId,
      action: "custom_agent_run_observed",
      entityType: "agent",
      entityId: String(data.agentId || "custom-agent"),
      payload: {
        createdTasks: Number(data.createdTasks || 0),
        assignedTasks: Number(data.assignedTasks || 0),
      },
      result: { observed: true },
    });
    await trackRun(orgPool, "custom-agent-run-observed", "completed");

    return {
      observed: true,
      projectId,
      agentId: String(data.agentId || ""),
      createdTasks: Number(data.createdTasks || 0),
      assignedTasks: Number(data.assignedTasks || 0),
    };
  }
);

export const meetingCompletedObserved = inngest.createFunction(
  { id: "meeting-completed-observed", name: "Meeting Completed Observed" },
  { event: "meeting/completed" },
  async ({ event }) => {
    const data = (event.data || {}) as MeetingCompletedData;
    const orgId = String(data.orgId || "").trim();
    const meetingId = String(data.meetingId || "").trim();
    if (!orgId || !meetingId) {
      return { observed: false, reason: "missing_org_or_meeting" };
    }

    const orgPool = await getTenantPool(orgId);
    const projectId = String(data.projectId || "").trim() || null;

    await logAction(orgPool, {
      projectId: projectId || undefined,
      action: "meeting_completed_observed",
      entityType: "meeting",
      entityId: meetingId,
      payload: {
        sprintId: data.sprintId || null,
        source: data.source || null,
        meetingType: data.meetingType || null,
        title: data.title || null,
      },
      result: { observed: true },
    });
    await trackRun(orgPool, "meeting-completed-observed", "completed");
    return { observed: true, meetingId, projectId };
  }
);

export const meetingTaskCreatedObserved = inngest.createFunction(
  { id: "meeting-task-created-observed", name: "Meeting Task Created Observed" },
  { event: "meeting/task.created" },
  async ({ event }) => {
    const data = (event.data || {}) as MeetingTaskCreatedData;
    const orgId = String(data.orgId || "").trim();
    const projectId = String(data.projectId || "").trim();
    const meetingId = String(data.meetingId || "").trim();
    const taskId = String(data.taskId || "").trim();
    if (!orgId || !projectId || !meetingId || !taskId) {
      return { observed: false, reason: "missing_required_fields" };
    }

    const orgPool = await getTenantPool(orgId);

    await logAction(orgPool, {
      projectId,
      action: "meeting_generated_task_observed",
      entityType: "task",
      entityId: taskId,
      payload: {
        meetingId,
        sprintId: data.sprintId || null,
        title: data.title || null,
        assigneeId: data.assigneeId || null,
        priority: data.priority || null,
        storyPoints: Number(data.storyPoints || 0),
      },
      result: { observed: true },
    });

    await trackRun(orgPool, "meeting-task-created-observed", "completed");
    return { observed: true, taskId, meetingId, projectId };
  }
);

async function runMonitoringPulse(orgPool: Pool, orgId: string, projectId: string): Promise<void> {
  const policy = await getProjectPolicy(orgPool, projectId);
  // Policy gating lets teams pause monitoring without changing deployment config.
  if (!policy.monitoringEnabled) return;

  const githubEvents = await orgPool.query(
    `SELECT COUNT(*)::int AS c
     FROM webhook_events
     WHERE source = 'github'
       AND created_at >= NOW() - INTERVAL '2 hours'`
  );
  const blocked = await orgPool.query(
    `SELECT COUNT(*)::int AS c FROM tasks WHERE project_id = $1 AND status = 'blocked'`,
    [String(projectId)]
  );
  const overload = await orgPool.query(
    `SELECT COUNT(*)::int AS c
     FROM developer_profiles dp
     JOIN team_members tm ON tm.id = dp.member_id
     JOIN project_members pm ON pm.member_id = tm.id
     WHERE pm.project_id = $1
       AND tm.is_active = TRUE
       AND dp.max_sprint_capacity > 0
       AND (dp.current_sprint_load::numeric / dp.max_sprint_capacity::numeric) >= 0.85`,
    [String(projectId)]
  );

  const inactive = await orgPool.query(
    `SELECT COUNT(*)::int AS c
     FROM tasks
     WHERE project_id = $1
       AND status IN ('todo','in_progress')
       AND COALESCE(updated_at, created_at) < NOW() - INTERVAL '3 days'`,
    [String(projectId)]
  );

  const staleBlocked = await orgPool.query(
    `SELECT id
     FROM tasks
     WHERE project_id = $1
       AND status = 'blocked'
       AND COALESCE(updated_at, created_at) < NOW() - INTERVAL '2 days'
     ORDER BY updated_at ASC
     LIMIT 5`,
    [String(projectId)]
  );

  let reassigned = 0;
  if (policy.autoAssign && !policy.guardedMode) {
    for (const row of staleBlocked.rows) {
      const result = await autoAssignTask(orgPool, String(row.id), projectId, { forceReassign: true });
      if (result.assigned) reassigned += 1;
    }
  }

  const alertCount = Number(blocked.rows[0]?.c || 0) + Number(overload.rows[0]?.c || 0) + Number(inactive.rows[0]?.c || 0);
  if (alertCount <= 0) return;

  const scrumMembers = await orgPool.query(
    `SELECT DISTINCT member_id FROM project_members WHERE project_id = $1 AND role IN ('owner','admin','manager')`,
    [String(projectId)]
  );
  for (const member of scrumMembers.rows) {
    await orgPool.query(
      `INSERT INTO notifications (recipient_member_id, type, title, body, action_url, reference_type)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        String(member.member_id),
        "monitoring_alert",
        "Project monitoring alert",
        `GitHub events(2h): ${Number(githubEvents.rows[0]?.c || 0)}, blocked tasks: ${Number(blocked.rows[0]?.c || 0)}, inactive tasks: ${Number(inactive.rows[0]?.c || 0)}, overload developers: ${Number(overload.rows[0]?.c || 0)}, reassignments: ${reassigned}`,
        `/monitoring?projectId=${encodeURIComponent(projectId)}`,
        "project",
      ]
    );
  }
  await logAction(orgPool, {
    projectId,
    action: "monitoring_alert_generated",
    entityType: "project",
    entityId: projectId,
    payload: { orgId },
    result: {
      githubEvents2h: Number(githubEvents.rows[0]?.c || 0),
      blockedTasks: Number(blocked.rows[0]?.c || 0),
      inactiveTasks: Number(inactive.rows[0]?.c || 0),
      overloadedDevelopers: Number(overload.rows[0]?.c || 0),
      autoReassigned: reassigned,
    },
  });
}

export const projectMonitoringPulse = inngest.createFunction(
  { id: "project-monitoring-pulse", name: "Project Monitoring Pulse" },
  { cron: MONITORING_CRON },
  async () => {
    const orgs = await getUniversalPool().query(
      `SELECT id FROM organizations WHERE db_connection_string IS NOT NULL AND LENGTH(TRIM(db_connection_string)) > 0`
    );
    const summary: Array<Record<string, unknown>> = [];
    for (const org of orgs.rows) {
      const orgId = String(org.id);
      const orgPool = await getTenantPool(orgId);
      await trackRun(orgPool, "project-monitoring-pulse", "running", new Date(Date.now() + 30 * 60 * 1000).toISOString());
      const projects = await orgPool.query(`SELECT id FROM projects`);
      for (const project of projects.rows) {
        await runMonitoringPulse(orgPool, orgId, String(project.id));
      }
      summary.push({ orgId, projects: projects.rows.length });
      await trackRun(orgPool, "project-monitoring-pulse", "completed", new Date(Date.now() + 30 * 60 * 1000).toISOString());
    }
    return { ok: true, summary };
  }
);

export const prMergedToDone = inngest.createFunction(
  { id: "pr-merged-to-done", name: "PR Merged to Done" },
  { event: "github/pr.merged" },
  async ({ event }) => {
    const data = event.data as PrMergedData;
    const orgPool = await getTenantPool(data.orgId);
    await trackRun(orgPool, "pr-merged-to-done", "running");

    try {
      let taskResp = await orgPool.query(
        `SELECT id, sprint_id, jira_issue_key, assignee_id FROM tasks WHERE project_id = $1 AND github_pr_number = $2 LIMIT 1`,
        [String(data.projectId), Number(data.prNumber)]
      );
      if (!taskResp.rows[0] && data.branchName) {
        const code = extractTaskCode(data.branchName);
        if (code) {
          taskResp = await orgPool.query(
            `SELECT id, sprint_id, jira_issue_key, assignee_id FROM tasks WHERE project_id = $1 AND UPPER(jira_issue_key) = UPPER($2) LIMIT 1`,
            [String(data.projectId), code]
          );
        }
      }

      const task = taskResp.rows[0];
      if (!task) {
        await logAction(orgPool, {
          projectId: data.projectId,
          action: "pr_merged_no_task_found",
          entityType: "pr",
          entityId: String(data.prNumber),
          payload: { branchName: data.branchName || null },
          result: { ignored: true },
        });
        await trackRun(orgPool, "pr-merged-to-done", "completed");
        return { linked: false };
      }

      await orgPool.query(
        `UPDATE tasks SET status = 'done', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [String(task.id)]
      );
      await orgPool.query(
        `INSERT INTO task_comments (task_id, author_id, content, comment_type, metadata)
         VALUES ($1, NULL, $2, 'status_change', $3::jsonb)`,
        [
          String(task.id),
          `Auto-closed: PR #${Number(data.prNumber)} merged by ${String(data.mergedBy || "unknown")}`,
          JSON.stringify({ source: "task_factory", prNumber: Number(data.prNumber), mergedBy: data.mergedBy || null }),
        ]
      );

      const sprintMetrics = task.sprint_id ? await updateSprintCompletedPoints(orgPool, String(task.sprint_id)) : null;

      const assigneeMember = await orgPool.query(
        `SELECT tm.id AS member_id
         FROM developer_profiles dp
         JOIN team_members tm ON tm.id = dp.member_id
         WHERE dp.id = $1
         LIMIT 1`,
        [task.assignee_id || null]
      );
      if (assigneeMember.rows[0]?.member_id) {
        await orgPool.query(
          `INSERT INTO notifications (recipient_member_id, type, title, body, action_url, reference_id, reference_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            String(assigneeMember.rows[0].member_id),
            "task_completed",
            "Task auto-completed",
            `Your task ${String(task.jira_issue_key || task.id)} was auto-completed via PR merge`,
            `/tasks/${String(task.id)}`,
            String(task.id),
            "task",
          ]
        );
      }

      await logAction(orgPool, {
        projectId: data.projectId,
        action: "task_completed_from_merged_pr",
        entityType: "task",
        entityId: String(task.id),
        payload: { prNumber: data.prNumber },
        result: { sprintMetrics },
      });
      await trackRun(orgPool, "pr-merged-to-done", "completed");
      return { linked: true, taskId: String(task.id), code: String(task.jira_issue_key || task.id), sprintMetrics };
    } catch (error) {
      await logAction(orgPool, {
        projectId: data.projectId,
        action: "pr_merged_to_done_failed",
        entityType: "pr",
        entityId: String(data.prNumber),
        payload: { branchName: data.branchName || null },
        result: { error: String((error as Error)?.message || error) },
        status: "failed",
      });
      await trackRun(orgPool, "pr-merged-to-done", "failed");
      throw error;
    }
  }
);

async function runSprintCleanup(orgPool: Pool, projectId?: string): Promise<Array<Record<string, unknown>>> {
  const where = projectId ? "AND project_id = $1" : "";
  const params = projectId ? [String(projectId)] : [];
  const sprints = await orgPool.query(
    `SELECT id, project_id, name
     FROM sprints
     WHERE end_date = CURRENT_DATE
       AND status = 'active'
       ${where}`,
    params
  );

  const out: Array<Record<string, unknown>> = [];
  for (const sprint of sprints.rows) {
    const tasks = await orgPool.query(
      `SELECT id, status FROM tasks WHERE sprint_id = $1`,
      [String(sprint.id)]
    );
    const unfinished = tasks.rows.filter((t) => String(t.status) !== "done").map((t) => String(t.id));
    if (unfinished.length) {
      await orgPool.query(`UPDATE tasks SET sprint_id = NULL, updated_at = NOW() WHERE id = ANY($1::uuid[])`, [unfinished]);
      await logAction(orgPool, {
        projectId: String(sprint.project_id),
        action: "tasks_moved_to_backlog",
        entityType: "sprint",
        entityId: String(sprint.id),
        payload: { count: unfinished.length },
      });
    }

    await orgPool.query(`UPDATE sprints SET status = 'completed', updated_at = NOW() WHERE id = $1`, [String(sprint.id)]);
    const done = tasks.rows.length - unfinished.length;
    const scrumMembers = await orgPool.query(
      `SELECT DISTINCT member_id FROM project_members WHERE project_id = $1 AND role IN ('owner','admin','manager')`,
      [String(sprint.project_id)]
    );
    for (const member of scrumMembers.rows) {
      await orgPool.query(
        `INSERT INTO notifications (recipient_member_id, type, title, body, action_url, reference_id, reference_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          String(member.member_id),
          "sprint_completed",
          `Sprint ${String(sprint.name)} completed`,
          `Sprint ${String(sprint.name)} completed. ${done} tasks done, ${unfinished.length} moved to backlog.`,
          `/sprints/${String(sprint.id)}`,
          String(sprint.id),
          "sprint",
        ]
      );
    }

    out.push({ sprintId: String(sprint.id), done, carried: unfinished.length });
  }
  return out;
}

export const sprintEndCleanupCron = inngest.createFunction(
  { id: "sprint-end-cleanup-cron", name: "Sprint End Cleanup (Daily)" },
  { cron: DAILY_CLEANUP_CRON },
  async () => {
    const orgs = await getUniversalPool().query(
      `SELECT id FROM organizations WHERE db_connection_string IS NOT NULL AND LENGTH(TRIM(db_connection_string)) > 0`
    );
    const results: Array<Record<string, unknown>> = [];
    for (const org of orgs.rows) {
      const orgId = String(org.id);
      const orgPool = await getTenantPool(orgId);
      await trackRun(orgPool, "sprint-end-cleanup", "running", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
      const out = await runSprintCleanup(orgPool);
      results.push({ orgId, cleaned: out.length });
      await trackRun(orgPool, "sprint-end-cleanup", "completed", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    }
    return { ok: true, results };
  }
);

export const sprintEndCleanupEvent = inngest.createFunction(
  { id: "sprint-end-cleanup", name: "Sprint End Cleanup (Event)" },
  { event: "sprint/ending.tomorrow" },
  async ({ event }) => {
    const data = (event.data || {}) as EventBase;
    const orgPool = await getTenantPool(data.orgId);
    await trackRun(orgPool, "sprint-end-cleanup", "running", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    const out = await runSprintCleanup(orgPool, data.projectId || undefined);
    await trackRun(orgPool, "sprint-end-cleanup", "completed", new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    return { ok: true, cleaned: out.length, details: out };
  }
);
