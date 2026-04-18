const axios = require('axios');
const { randomUUID } = require('node:crypto');
const { emitToProject } = require('../../src/realtime/io');
const { queueEmbedTask } = require('./githubIngestion');
const { sendInngestEvent } = require('../../src/services/inngestEvent.service');

const STATUS_MAP = {
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'in_review',
  DONE: 'done',
  BLOCKED: 'blocked',
};

const DESTRUCTIVE_ACTIONS = new Set(['create_task', 'create_sprint', 'assign_task']);

function safe(value) {
  return String(value || '').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isAutoMode(mode) {
  return safe(mode).toLowerCase() === 'auto';
}

function jsonSchema(type, props, required = []) {
  return {
    type,
    properties: props,
    required,
    additionalProperties: false,
  };
}

function getToolDefinitions() {
  return [
    {
      name: 'create_task',
      description: 'Create a new task in the current project.',
      input_schema: jsonSchema(
        'object',
        {
          title: { type: 'string' },
          description: { type: 'string' },
          assigneeId: { type: 'string' },
          priority: { type: 'string' },
          sprintId: { type: 'string' },
          storyPoints: { type: 'integer', minimum: 0 },
          labels: { type: 'array', items: { type: 'string' } },
        },
        ['title', 'sprintId']
      ),
    },
    {
      name: 'update_task_status',
      description: 'Update the status of an existing task.',
      input_schema: jsonSchema(
        'object',
        {
          taskId: { type: 'string' },
          status: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED'] },
        },
        ['taskId', 'status']
      ),
    },
    {
      name: 'assign_task',
      description: 'Assign a task to a specific developer.',
      input_schema: jsonSchema(
        'object',
        {
          taskId: { type: 'string' },
          developerId: { type: 'string' },
          reason: { type: 'string' },
        },
        ['taskId', 'developerId']
      ),
    },
    {
      name: 'create_sprint',
      description: 'Create a new sprint in the current project.',
      input_schema: jsonSchema(
        'object',
        {
          name: { type: 'string' },
          goal: { type: 'string' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
        },
        ['name', 'startDate', 'endDate']
      ),
    },
    {
      name: 'move_tasks_to_sprint',
      description: 'Move multiple tasks to a sprint.',
      input_schema: jsonSchema(
        'object',
        {
          taskIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          sprintId: { type: 'string' },
        },
        ['taskIds', 'sprintId']
      ),
    },
    {
      name: 'get_team_workload',
      description: 'Get each developer open task count, points, and skills for a project.',
      input_schema: jsonSchema('object', { projectId: { type: 'string' } }, ['projectId']),
    },
    {
      name: 'get_sprint_health',
      description: 'Compute sprint completion, at-risk tasks, days remaining, and velocity.',
      input_schema: jsonSchema('object', { sprintId: { type: 'string' } }, ['sprintId']),
    },
    {
      name: 'create_github_issue',
      description: 'Create a GitHub issue for the current project repository.',
      input_schema: jsonSchema(
        'object',
        {
          title: { type: 'string' },
          body: { type: 'string' },
          labels: { type: 'array', items: { type: 'string' } },
          assigneeGithubLogin: { type: 'string' },
        },
        ['title']
      ),
    },
    {
      name: 'flag_blocker',
      description: 'Mark a task as blocked, add blocker comment, and notify assignee plus scrum leadership.',
      input_schema: jsonSchema(
        'object',
        {
          taskId: { type: 'string' },
          reason: { type: 'string' },
        },
        ['taskId', 'reason']
      ),
    },
    {
      name: 'suggest_assignments',
      description: 'Suggest the best developer per task based on skills, load, and similar-task completion.',
      input_schema: jsonSchema(
        'object',
        {
          taskIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
        ['taskIds']
      ),
    },
  ];
}

async function ensureAgentActionsTable(orgPool) {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS agent_actions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      user_id TEXT,
      agent_type TEXT,
      action_name TEXT,
      input JSONB,
      result JSONB,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
  await orgPool.query('ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS agent_type TEXT');
  await orgPool.query('ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS action TEXT');
  await orgPool.query('ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS entity_type TEXT');
  await orgPool.query('ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS entity_id TEXT');
    await orgPool.query('ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT \'{}\'::jsonb');
  await orgPool.query('ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS source TEXT');
  await orgPool.query('ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()');
}

async function ensureAgentTaskColumns(orgPool) {
  await orgPool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_source TEXT');
  await orgPool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_agent_id TEXT');
  await orgPool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by TEXT');
  await orgPool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ');
}

async function ensureAgentApprovalsTable(orgPool) {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS agent_approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      payload JSONB NOT NULL,
      status TEXT DEFAULT 'pending',
      decided_by TEXT,
      decided_at TIMESTAMPTZ,
      resolved_by TEXT,
      resolved_at TIMESTAMPTZ,
      resolution_note TEXT,
      modified_params JSONB,
      execution_result JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );

  await orgPool.query('ALTER TABLE agent_approvals ADD COLUMN IF NOT EXISTS resolved_by TEXT');
  await orgPool.query('ALTER TABLE agent_approvals ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ');
  await orgPool.query('ALTER TABLE agent_approvals ADD COLUMN IF NOT EXISTS resolution_note TEXT');
  await orgPool.query('ALTER TABLE agent_approvals ADD COLUMN IF NOT EXISTS modified_params JSONB');
  await orgPool.query('ALTER TABLE agent_approvals ADD COLUMN IF NOT EXISTS execution_result JSONB');
}

async function ensureAgentConfigsTable(orgPool) {
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

async function ensureAgentDecisionsTable(orgPool) {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS agent_decisions (
      id TEXT PRIMARY KEY,
      agent_type TEXT NOT NULL,
      project_id TEXT,
      action_description TEXT NOT NULL,
      reasoning JSONB,
      confidence NUMERIC,
      data_used JSONB,
      status TEXT,
      resolved_by TEXT,
      resolved_at TIMESTAMPTZ,
      resolution_type TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
}

async function getActorMemberId(orgPool, userId) {
  const resp = await orgPool.query(
    'SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1',
    [String(userId || '')]
  );
  return resp.rows[0]?.id || null;
}

async function insertActionLog(orgPool, row) {
  await ensureAgentActionsTable(orgPool);
  await orgPool.query(
    `INSERT INTO agent_actions (id, project_id, user_id, agent_type, action_name, input, result, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      String(row.id),
      row.projectId ? String(row.projectId) : null,
      row.userId ? String(row.userId) : null,
      row.agentType ? String(row.agentType) : null,
      String(row.actionName),
      JSON.stringify(row.input || {}),
      JSON.stringify(row.result || {}),
      String(row.status || 'pending'),
    ]
  );
}

async function updateActionLog(orgPool, id, status, result) {
  await orgPool.query(
    `UPDATE agent_actions
     SET status = $2,
         result = $3::jsonb
     WHERE id = $1`,
    [String(id), String(status), JSON.stringify(result || {})]
  );
}

async function createPendingAction(orgPool, context, name, input, preview) {
  const actionId = randomUUID();
  const payload = { type: 'confirmation_required', action: name, input, preview, actionId };
  const title = `Approval required: ${String(name).replace(/_/g, ' ')}`;
  const description = safe(preview?.reasoning || preview?.summary || '') || `Agent requested ${name} action.`;

  await ensureAgentApprovalsTable(orgPool);
  await orgPool.query(
    `INSERT INTO agent_approvals (id, project_id, action_type, title, description, payload, status)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,'pending')`,
    [
      String(actionId),
      String(context.projectId),
      String(name),
      title,
      description,
      JSON.stringify({ actionType: name, input, preview, agentType: safe(context.agentId) || null }),
    ]
  );

  await insertActionLog(orgPool, {
    id: actionId,
    projectId: context.projectId,
    userId: context.userId,
    agentType: safe(context.agentId) || null,
    actionName: name,
    input,
    result: { approvalId: actionId, title, description },
    status: 'pending_approval',
  });

  emitToProject(context.projectId, 'agent:approval', {
    id: actionId,
    projectId: context.projectId,
    actionType: name,
    title,
    description,
    status: 'pending',
    payload: { actionType: name, input, preview },
    createdAt: new Date().toISOString(),
  });

  return payload;
}

async function getStoredGithubAccessToken(orgPool) {
  const resp = await orgPool.query(
    `SELECT access_token_enc
     FROM github_integration
     WHERE is_active = TRUE
     ORDER BY created_at ASC
     LIMIT 1`
  );
  const raw = resp.rows[0]?.access_token_enc;
  if (!raw) throw Object.assign(new Error('GitHub integration not connected'), { statusCode: 400 });
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const token = safe(parsed?.accessToken);
    if (token) return token;
  } catch {
    // ignore
  }
  const token = safe(raw);
  if (!token) throw Object.assign(new Error('GitHub token is invalid'), { statusCode: 400 });
  return token;
}

async function createTask(orgPool, context, input) {
  await ensureAgentTaskColumns(orgPool);
  let actorMemberId = await getActorMemberId(orgPool, context.userId);
  if (!actorMemberId) {
    const fallback = await orgPool.query(
      `SELECT member_id
       FROM project_members
       WHERE project_id = $1
       ORDER BY created_at ASC
       LIMIT 1`,
      [String(context.projectId)]
    );
    actorMemberId = fallback.rows[0]?.member_id || null;
  }
  const storyPoints = Number(input.storyPoints || 0);
  const labels = toArray(input.labels).map((v) => String(v));
  const resp = await orgPool.query(
    `INSERT INTO tasks (
       sprint_id, project_id, title, description, status, type, priority,
       story_points, tech_tags, assignee_id, created_by,
       created_source, created_agent_id, assigned_by, assigned_at
     )
     VALUES ($1,$2,$3,$4,'todo','task',$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id, jira_issue_key, project_id, sprint_id, title, priority, story_points, tech_tags, assignee_id`,
    [
      String(input.sprintId),
      String(context.projectId),
      String(input.title),
      safe(input.description) || null,
      safe(input.priority).toLowerCase() || 'medium',
      Number.isFinite(storyPoints) ? storyPoints : 0,
      labels,
      safe(input.assigneeId) || null,
      actorMemberId,
      'agent',
      safe(context.agentId) || null,
      safe(input.assigneeId) ? 'ai_agentic' : null,
      safe(input.assigneeId) ? new Date().toISOString() : null,
    ]
  );
  const row = resp.rows[0];

  queueEmbedTask({ task: row, orgPool });
  try {
    await sendInngestEvent('task/created', {
      orgId: String(context.orgId || ''),
      projectId: String(row.project_id || context.projectId || ''),
      sprintId: row.sprint_id ? String(row.sprint_id) : null,
      taskId: String(row.id || ''),
      title: String(row.title || ''),
      priority: String(row.priority || 'medium'),
      storyPoints: Number(row.story_points || 0),
      techTags: Array.isArray(row.tech_tags) ? row.tech_tags : [],
      assigneeId: row.assignee_id ? String(row.assignee_id) : null,
      createdByAgentId: safe(context.agentId) || null,
    });
  } catch {
    // Ignore event dispatch failures for action execution.
  }

  return {
    taskId: row.id,
    code: row.jira_issue_key || `TASK-${String(row.id).slice(0, 8)}`,
    url: `/tasks/${row.id}`,
  };
}

async function updateTaskStatus(orgPool, context, input) {
  const mappedStatus = STATUS_MAP[String(input.status || '').toUpperCase()];
  if (!mappedStatus) throw Object.assign(new Error('Invalid status'), { statusCode: 400 });
  const beforeResp = await orgPool.query(
    'SELECT id, status FROM tasks WHERE id = $1 AND project_id = $2 LIMIT 1',
    [String(input.taskId), String(context.projectId)]
  );
  const before = beforeResp.rows[0];
  if (!before) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
  await orgPool.query('UPDATE tasks SET status = $2, updated_at = NOW() WHERE id = $1', [String(input.taskId), mappedStatus]);
  return { taskId: String(input.taskId), oldStatus: before.status, newStatus: mappedStatus };
}

async function assignTask(orgPool, context, input) {
  await ensureAgentTaskColumns(orgPool);
  const taskResp = await orgPool.query(
    'SELECT id FROM tasks WHERE id = $1 AND project_id = $2 LIMIT 1',
    [String(input.taskId), String(context.projectId)]
  );
  if (!taskResp.rows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

  const devResp = await orgPool.query(
    `SELECT dp.id, tm.full_name
     FROM developer_profiles dp
     JOIN team_members tm ON tm.id = dp.member_id
     WHERE dp.id = $1
     LIMIT 1`,
    [String(input.developerId)]
  );
  const dev = devResp.rows[0];
  if (!dev) throw Object.assign(new Error('Developer not found'), { statusCode: 404 });

  await orgPool.query('UPDATE tasks SET assignee_id = $2, assigned_by = $3, assigned_at = NOW(), updated_at = NOW() WHERE id = $1', [
    String(input.taskId),
    String(input.developerId),
    'ai_agentic',
  ]);

  return { taskId: String(input.taskId), developerName: dev.full_name };
}

async function createSprint(orgPool, context, input) {
  const actorMemberId = await getActorMemberId(orgPool, context.userId);
  const numberResp = await orgPool.query(
    'SELECT COALESCE(MAX(sprint_number), 0)::int + 1 AS next FROM sprints WHERE project_id = $1',
    [String(context.projectId)]
  );
  const sprintNumber = Number(numberResp.rows[0]?.next || 1);
  const resp = await orgPool.query(
    `INSERT INTO sprints (project_id, name, goal, sprint_number, start_date, end_date, created_by)
     VALUES ($1,$2,$3,$4,$5::date,$6::date,$7)
     RETURNING id, name`,
    [
      String(context.projectId),
      String(input.name),
      safe(input.goal) || null,
      sprintNumber,
      String(input.startDate),
      String(input.endDate),
      actorMemberId,
    ]
  );
  return { sprintId: resp.rows[0].id, name: resp.rows[0].name };
}

async function moveTasksToSprint(orgPool, context, input) {
  const taskIds = toArray(input.taskIds).map((id) => String(id));
  if (!taskIds.length) return { moved: 0 };
  const resp = await orgPool.query(
    `UPDATE tasks
     SET sprint_id = $2, updated_at = NOW()
     WHERE id = ANY($1::uuid[])
       AND project_id = $3`,
    [taskIds, String(input.sprintId), String(context.projectId)]
  );
  return { moved: Number(resp.rowCount || 0) };
}

async function getTeamWorkload(orgPool, context, input) {
  const projectId = safe(input.projectId) || String(context.projectId);
  const resp = await orgPool.query(
    `SELECT
       tm.full_name AS name,
       COALESCE(COUNT(t.id) FILTER (WHERE t.status IN ('todo','in_progress','in_review','blocked')), 0)::int AS task_count,
       COALESCE(SUM(t.story_points) FILTER (WHERE t.status IN ('todo','in_progress','in_review','blocked')), 0)::int AS story_points,
       dp.tech_stack AS skills
     FROM project_members pm
     JOIN team_members tm ON tm.id = pm.member_id
     LEFT JOIN developer_profiles dp ON dp.member_id = tm.id
     LEFT JOIN tasks t ON t.assignee_id = dp.id AND t.project_id = pm.project_id
     WHERE pm.project_id = $1
     GROUP BY tm.full_name, dp.tech_stack
     ORDER BY tm.full_name ASC`,
    [String(projectId)]
  );
  return resp.rows.map((r) => ({
    name: r.name,
    taskCount: Number(r.task_count || 0),
    storyPoints: Number(r.story_points || 0),
    skills: Array.isArray(r.skills) ? r.skills : [],
  }));
}

async function getSprintHealth(orgPool, input) {
  const sprintResp = await orgPool.query(
    `SELECT id, start_date, end_date, completed_points, actual_velocity
     FROM sprints
     WHERE id = $1
     LIMIT 1`,
    [String(input.sprintId)]
  );
  const sprint = sprintResp.rows[0];
  if (!sprint) throw Object.assign(new Error('Sprint not found'), { statusCode: 404 });

  const taskResp = await orgPool.query(
    `SELECT id, title, status, due_date
     FROM tasks
     WHERE sprint_id = $1`,
    [String(input.sprintId)]
  );
  const rows = taskResp.rows;
  const total = rows.length || 1;
  const done = rows.filter((r) => r.status === 'done').length;
  const today = new Date().toISOString().slice(0, 10);
  const atRisk = rows
    .filter((r) => r.status === 'blocked' || (r.due_date && String(r.due_date) < today && r.status !== 'done'))
    .map((r) => ({ taskId: r.id, title: r.title, status: r.status }));

  const endDate = new Date(`${String(sprint.end_date).slice(0, 10)}T00:00:00.000Z`);
  const now = new Date();
  const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / 86400000));

  return {
    donePercent: Math.round((done / total) * 10000) / 100,
    atRisk,
    daysRemaining,
    velocity: Number(sprint.actual_velocity || 0) || Number(sprint.completed_points || 0),
  };
}

async function createGithubIssue(orgPool, context, input) {
  const projectResp = await orgPool.query('SELECT github_repo FROM projects WHERE id = $1 LIMIT 1', [String(context.projectId)]);
  const fullRepo = safe(projectResp.rows[0]?.github_repo);
  const parts = fullRepo.split('/');
  if (parts.length !== 2) throw Object.assign(new Error('Project GitHub repo is not configured.'), { statusCode: 400 });

  const token = await getStoredGithubAccessToken(orgPool);
  const client = axios.create({
    baseURL: 'https://api.github.com',
    timeout: 30000,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-sprint-manager-api-gateway',
    },
  });

  const [owner, repo] = parts;
  const payload = {
    title: String(input.title),
    body: safe(input.body) || null,
    labels: toArray(input.labels).map((l) => String(l)),
  };
  if (safe(input.assigneeGithubLogin)) payload.assignees = [String(input.assigneeGithubLogin)];

  const resp = await client.post(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, payload);
  return { issueNumber: resp.data?.number, url: resp.data?.html_url };
}

async function flagBlocker(orgPool, context, input) {
  const actorMemberId = await getActorMemberId(orgPool, context.userId);
  const taskResp = await orgPool.query(
    `SELECT t.id, t.title, t.assignee_id, t.sprint_id, dp.member_id AS assignee_member_id
     FROM tasks t
     LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
     WHERE t.id = $1 AND t.project_id = $2
     LIMIT 1`,
    [String(input.taskId), String(context.projectId)]
  );
  const task = taskResp.rows[0];
  if (!task) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

  await orgPool.query('UPDATE tasks SET status = $2, ai_delay_risk = TRUE, updated_at = NOW() WHERE id = $1', [
    String(input.taskId),
    'blocked',
  ]);

  await orgPool.query(
    `INSERT INTO task_comments (task_id, author_id, content, comment_type, metadata)
     VALUES ($1,$2,$3,'blocker',$4::jsonb)`,
    [String(input.taskId), actorMemberId, String(input.reason), JSON.stringify({ flaggedBy: 'ai_agent' })]
  );

  const notifyResp = await orgPool.query(
    `SELECT DISTINCT member_id
     FROM (
       SELECT pm.member_id
       FROM project_members pm
       WHERE pm.project_id = $1
         AND pm.role IN ('owner','admin','manager')
       UNION
       SELECT $2::uuid AS member_id
     ) x
     WHERE member_id IS NOT NULL`,
    [String(context.projectId), task.assignee_member_id || null]
  );

  const notifiedUsers = [];
  for (const row of notifyResp.rows) {
    notifiedUsers.push(String(row.member_id));
    await orgPool.query(
      `INSERT INTO notifications (recipient_member_id, type, title, body, reference_id, reference_type, action_url)
       VALUES ($1, 'delay_alert', $2, $3, $4, 'task', $5)`,
      [
        String(row.member_id),
        `Task blocked: ${task.title}`,
        String(input.reason),
        String(input.taskId),
        `/tasks/${String(input.taskId)}`,
      ]
    );
  }

  return { taskId: String(input.taskId), notifiedUsers };
}

async function suggestAssignments(orgPool, context, input) {
  const taskIds = toArray(input.taskIds).map((id) => String(id));
  if (!taskIds.length) return [];

  const devResp = await orgPool.query(
    `SELECT dp.id, tm.full_name, dp.tech_stack, dp.current_sprint_load, dp.max_sprint_capacity
     FROM project_members pm
     JOIN team_members tm ON tm.id = pm.member_id
     JOIN developer_profiles dp ON dp.member_id = tm.id
     WHERE pm.project_id = $1`,
    [String(context.projectId)]
  );
  const devs = devResp.rows;

  const results = [];
  for (const taskId of taskIds) {
    const taskResp = await orgPool.query(
      'SELECT id, title FROM tasks WHERE id = $1 AND project_id = $2 LIMIT 1',
      [taskId, String(context.projectId)]
    );
    const task = taskResp.rows[0];
    if (!task || !devs.length) continue;

    let best = null;
    const titleTokens = safe(task.title).toLowerCase().split(/\s+/).filter(Boolean);

    for (const dev of devs) {
      const skills = toArray(dev.tech_stack).map((s) => String(s).toLowerCase());
      const skillHits = titleTokens.filter((t) => skills.some((s) => s.includes(t) || t.includes(s))).length;
      const skillScore = titleTokens.length ? skillHits / titleTokens.length : 0;

      const openLoad = Number(dev.current_sprint_load || 0);
      const cap = Math.max(1, Number(dev.max_sprint_capacity || 1));
      const loadScore = 1 - Math.min(1, openLoad / cap);

      const completionResp = await orgPool.query(
        `SELECT
           COUNT(*) FILTER (WHERE t.status = 'done')::int AS done_count,
           COUNT(*)::int AS total_count
         FROM assignment_log al
         JOIN tasks t ON t.id = al.task_id
         WHERE al.developer_id = $1
           AND t.project_id = $2
           AND EXISTS (
             SELECT 1
             FROM unnest(COALESCE(t.tech_tags, ARRAY[]::text[])) tag
             WHERE LOWER(tag) = ANY($3::text[])
           )`,
        [String(dev.id), String(context.projectId), skills]
      );
      const doneCount = Number(completionResp.rows[0]?.done_count || 0);
      const totalCount = Number(completionResp.rows[0]?.total_count || 0);
      const completionScore = totalCount > 0 ? doneCount / totalCount : 0.5;

      const score = Math.round((skillScore * 0.45 + loadScore * 0.35 + completionScore * 0.2) * 10000) / 100;
      const reason = `skill:${Math.round(skillScore * 100)} load:${Math.round(loadScore * 100)} completion:${Math.round(completionScore * 100)}`;

      if (!best || score > best.score) {
        best = { devId: String(dev.id), name: dev.full_name, score, reason };
      }
    }

    if (best) results.push({ taskId: String(task.id), recommended: best });
  }

  return results;
}

async function executeCoreAction(orgPool, context, name, input) {
  if (name === 'create_task') return createTask(orgPool, context, input);
  if (name === 'update_task_status') return updateTaskStatus(orgPool, context, input);
  if (name === 'assign_task') return assignTask(orgPool, context, input);
  if (name === 'create_sprint') return createSprint(orgPool, context, input);
  if (name === 'move_tasks_to_sprint') return moveTasksToSprint(orgPool, context, input);
  if (name === 'get_team_workload') return getTeamWorkload(orgPool, context, input);
  if (name === 'get_sprint_health') return getSprintHealth(orgPool, input);
  if (name === 'create_github_issue') return createGithubIssue(orgPool, context, input);
  if (name === 'flag_blocker') return flagBlocker(orgPool, context, input);
  if (name === 'suggest_assignments') return suggestAssignments(orgPool, context, input);
  throw Object.assign(new Error(`Unsupported action: ${name}`), { statusCode: 400 });
}

async function executeActionWithPolicy(orgPool, context, name, input) {
  if (DESTRUCTIVE_ACTIONS.has(name) && !isAutoMode(context.executionMode)) {
    const preview = { action: name, projectId: context.projectId, input };
    return createPendingAction(orgPool, context, name, input, preview);
  }

  const actionId = randomUUID();
  await insertActionLog(orgPool, {
    id: actionId,
    projectId: context.projectId,
    userId: context.userId,
    agentType: safe(context.agentId) || null,
    actionName: name,
    input,
    result: {},
    status: 'confirmed',
  });

  try {
    const result = await executeCoreAction(orgPool, context, name, input);
    await updateActionLog(orgPool, actionId, 'executed', result);
    emitToProject(context.projectId, 'agent:action', {
      id: actionId,
      projectId: context.projectId,
      actionName: name,
      status: 'executed',
      result,
      createdAt: new Date().toISOString(),
    });
    return result;
  } catch (err) {
    await updateActionLog(orgPool, actionId, 'failed', { error: safe(err?.message) || 'Action failed' });
    emitToProject(context.projectId, 'agent:action', {
      id: actionId,
      projectId: context.projectId,
      actionName: name,
      status: 'failed',
      result: { error: safe(err?.message) || 'Action failed' },
      createdAt: new Date().toISOString(),
    });
    throw err;
  }
}

async function confirmPendingAction(orgPool, context, actionId) {
  await ensureAgentActionsTable(orgPool);
  const resp = await orgPool.query(
    `SELECT id, action_name, input, status
     FROM agent_actions
     WHERE id = $1 AND project_id = $2
     LIMIT 1`,
    [String(actionId), String(context.projectId)]
  );
  const row = resp.rows[0];
  if (!row) throw Object.assign(new Error('Action not found'), { statusCode: 404 });
  const currentStatus = String(row.status || '');
  if (currentStatus !== 'pending' && currentStatus !== 'pending_approval') {
    throw Object.assign(new Error('Action is not pending'), { statusCode: 400 });
  }

  await updateActionLog(orgPool, row.id, 'confirmed', row.input || {});

  try {
    const result = await executeCoreAction(orgPool, context, row.action_name, row.input || {});
    await updateActionLog(orgPool, row.id, 'executed', result);
    return { actionId: String(row.id), action: row.action_name, result };
  } catch (err) {
    await updateActionLog(orgPool, row.id, 'failed', { error: safe(err?.message) || 'Action failed' });
    throw err;
  }
}

module.exports = {
  getToolDefinitions,
  executeActionWithPolicy,
  confirmPendingAction,
  ensureAgentActionsTable,
  ensureAgentApprovalsTable,
  ensureAgentConfigsTable,
  ensureAgentDecisionsTable,
  executeCoreAction,
};