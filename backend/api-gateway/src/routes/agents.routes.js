const express = require('express');
const { randomUUID } = require('node:crypto');
const axios = require('axios');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const { getAgentsRuntime } = require('../../server/agents');
const {
  ensureAgentActionsTable,
  ensureAgentApprovalsTable,
  ensureAgentConfigsTable,
  ensureAgentDecisionsTable,
  executeCoreAction,
  executeActionWithPolicy,
} = require('../../server/lib/agentActions');
const { assignmentService } = require('../services/assignment.service');
const { emailService } = require('../services/email.service');
const { emitToProject } = require('../realtime/io');
const { sendInngestEvent, getInngestEventEndpoint } = require('../services/inngestEvent.service');
const { ensureEmbeddingsInfrastructure } = require('../../server/lib/embeddings');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

function safe(value) {
  return String(value || '').trim();
}

function jsonError(res, status, error, detail) {
  return res.status(status).json({ error, code: status, detail });
}

const AGENT_CATALOG = [
  {
    id: 'sprint-autopilot',
    name: 'Sprint Autopilot',
    description: 'Plans sprint moves and closes execution gaps before deadlines.',
    runtimeHints: ['sprint-risk-monitor', 'sprint-completion-reporter'],
  },
  {
    id: 'developer-intelligence',
    name: 'Developer Intelligence',
    description: 'Balances team load and flags assignment bottlenecks.',
    runtimeHints: ['stale-task-detector', 'unassigned-task-alert'],
  },
  {
    id: 'pr-review-agent',
    name: 'PR Review Agent',
    description: 'Tracks PR latency and review-cycle risks.',
    runtimeHints: ['daily-standup-compiler'],
  },
];

const CUSTOM_AGENT_ROLES = new Set(['task-generator', 'assignment', 'monitoring', 'custom']);

function normalizeAgentId(value) {
  return safe(value).toLowerCase().replace(/\s+/g, '-');
}

function normalizeRole(value) {
  const role = normalizeAgentId(value || 'custom');
  if (CUSTOM_AGENT_ROLES.has(role)) return role;
  if (role.includes('task')) return 'task-generator';
  if (role.includes('assign')) return 'assignment';
  if (role.includes('monitor')) return 'monitoring';
  return 'custom';
}

function toTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? safe(item) : safe(item?.name || item?.type || item?.value)))
    .filter(Boolean)
    .slice(0, 100);
}

function parseJsonish(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return {};
}

function firstAgentHint(agentId) {
  const catalog = AGENT_CATALOG.find((item) => item.id === normalizeAgentId(agentId));
  return catalog?.runtimeHints?.[0] || '';
}

async function ensureAgentRunsStatusTable(orgPool) {
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
  await orgPool.query('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS next_run TIMESTAMPTZ');
  await orgPool.query('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS actions_today INTEGER DEFAULT 0');
  await orgPool.query('ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS last_result JSONB');
}

async function getAgentRunMap(orgPool) {
  await ensureAgentRunsStatusTable(orgPool);
  const resp = await orgPool.query(
    `SELECT
       agent_name,
       last_run,
       next_run,
       last_status,
       COALESCE(
         CASE WHEN DATE(last_run) = CURRENT_DATE THEN actions_today ELSE 0 END,
         0
       )::int AS action_count_today
     FROM agent_runs`
  );
  const map = new Map();
  for (const row of resp.rows) map.set(String(row.agent_name || ''), row);
  return map;
}

async function isGithubConnected(orgPool) {
  try {
    const resp = await orgPool.query(
      `SELECT 1
       FROM github_integration
       WHERE is_active = TRUE
       LIMIT 1`
    );
    return Boolean(resp.rows[0]);
  } catch {
    return false;
  }
}

async function listAgentConfigRows(orgPool, projectId) {
  await ensureAgentConfigsTable(orgPool);
  if (!projectId) return [];
  const resp = await orgPool.query(
    `SELECT agent_type, trigger_settings, autonomy_level, constraints, context_memo, updated_at
     FROM agent_configs
     WHERE project_id = $1`,
    [String(projectId)]
  );
  return resp.rows || [];
}

async function insertAgentDecision(orgPool, payload) {
  await ensureAgentDecisionsTable(orgPool);
  await orgPool.query(
    `INSERT INTO agent_decisions (
       id, agent_type, project_id, action_description,
       reasoning, confidence, data_used, status,
       resolved_by, resolved_at, resolution_type
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,NOW(),$10)`,
    [
      randomUUID(),
      String(payload.agentType),
      payload.projectId ? String(payload.projectId) : null,
      String(payload.actionDescription),
      JSON.stringify(payload.reasoning || {}),
      Number(payload.confidence || 80),
      JSON.stringify(payload.dataUsed || {}),
      String(payload.status || 'executed'),
      payload.resolvedBy ? String(payload.resolvedBy) : null,
      payload.resolutionType ? String(payload.resolutionType) : 'auto-executed',
    ]
  );
}

async function buildRoster(orgPool, runtime, projectId) {
  const githubConnected = await isGithubConnected(orgPool);
  const allowedIds = new Set(githubConnected ? AGENT_CATALOG.map((x) => x.id) : AGENT_CATALOG.filter((x) => x.id !== 'pr-review-agent').map((x) => x.id));
  const runtimeRows = runtime && typeof runtime.getStatus === 'function' ? await runtime.getStatus(orgPool) : [];
  const configRows = await listAgentConfigRows(orgPool, projectId);

  const builtInAgents = AGENT_CATALOG.filter((item) => allowedIds.has(item.id)).map((item) => {
    const config = configRows.find((row) => normalizeAgentId(row.agent_type) === item.id);
    const statusOverride = safe(config?.constraints?.status || '').toLowerCase();
    const runtimeRow = runtimeRows.find((row) => item.runtimeHints.some((hint) => safe(row?.name).toLowerCase() === hint));
    const runtimeStatus = safe(runtimeRow?.status || 'active').toLowerCase();
    const status = statusOverride || (runtimeStatus.includes('pause') ? 'paused' : runtimeStatus.includes('error') ? 'error' : 'active');
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      status,
      lastActionAt: runtimeRow?.lastRun || null,
      runtimeName: safe(runtimeRow?.name) || firstAgentHint(item.id),
      role: item.id === 'sprint-autopilot' ? 'task-generator' : item.id === 'developer-intelligence' ? 'assignment' : 'monitoring',
      dataSources: [],
      isCustom: false,
    };
  });

  const customRows = projectId ? await listCustomAgentsForProject(orgPool, projectId) : [];
  const customAgents = customRows.map((row) => {
    const cfg = configRows.find((item) => normalizeAgentId(item.agent_type) === normalizeAgentId(row.id));
    const statusOverride = safe(cfg?.constraints?.status || '').toLowerCase();
    const enabled = Boolean(row.enabled);
    return {
      id: String(row.id),
      name: String(row.name),
      description: `${String(row.role || 'custom')} custom agent`,
      status: statusOverride || (enabled ? 'active' : 'paused'),
      lastActionAt: row.updated_at || null,
      runtimeName: String(row.id),
      role: String(row.role || 'custom'),
      dataSources: Array.isArray(row.data_sources) ? row.data_sources : [],
      isCustom: true,
    };
  });

  return [...builtInAgents, ...customAgents];
}

async function ensureProjectAccess(orgPool, projectId, actorMemberId, role) {
  const existsResp = await orgPool.query('SELECT id FROM projects WHERE id = $1 LIMIT 1', [String(projectId)]);
  if (!existsResp.rows[0]) return { ok: false, reason: 'Project not found in org database.' };

  const tokenRole = safe(role).toLowerCase();
  if (tokenRole === 'owner' || tokenRole === 'admin') return { ok: true };

  const memberResp = await orgPool.query(
    'SELECT 1 FROM project_members WHERE project_id = $1 AND member_id = $2 LIMIT 1',
    [String(projectId), String(actorMemberId)]
  );
  if (!memberResp.rows[0]) return { ok: false, reason: 'User is not a member of this project.' };
  return { ok: true };
}

async function ensureCustomAgentsTables(orgPool) {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS custom_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      data_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
      trigger_events JSONB NOT NULL DEFAULT '[]'::jsonb,
      trigger_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
      actions JSONB NOT NULL DEFAULT '[]'::jsonb,
      autonomy_level INTEGER NOT NULL DEFAULT 2,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS custom_agent_projects (
      agent_id TEXT NOT NULL REFERENCES custom_agents(id) ON DELETE CASCADE,
      project_id UUID NOT NULL,
      PRIMARY KEY (agent_id, project_id)
    )`
  );
}

async function listCustomAgentsForProject(orgPool, projectId) {
  await ensureCustomAgentsTables(orgPool);
  if (!projectId) return [];
  const resp = await orgPool.query(
    `SELECT
       ca.id,
       ca.name,
       ca.role,
       ca.data_sources,
       ca.trigger_events,
       ca.trigger_conditions,
       ca.actions,
       ca.autonomy_level,
       ca.enabled,
       ca.updated_at
     FROM custom_agents ca
     JOIN custom_agent_projects cap ON cap.agent_id = ca.id
     WHERE cap.project_id = $1
     ORDER BY ca.created_at ASC`,
    [String(projectId)]
  );
  return resp.rows || [];
}

async function getCustomAgentById(orgPool, agentId) {
  await ensureCustomAgentsTables(orgPool);
  const resp = await orgPool.query(
    `SELECT id, name, role, data_sources, trigger_events, trigger_conditions, actions, autonomy_level, enabled, updated_at
     FROM custom_agents
     WHERE id = $1
     LIMIT 1`,
    [String(agentId)]
  );
  return resp.rows[0] || null;
}

async function isCustomAgentAssignedToProject(orgPool, agentId, projectId) {
  await ensureCustomAgentsTables(orgPool);
  const resp = await orgPool.query(
    `SELECT 1
     FROM custom_agent_projects
     WHERE agent_id = $1 AND project_id = $2
     LIMIT 1`,
    [String(agentId), String(projectId)]
  );
  return Boolean(resp.rows[0]);
}

async function listCustomAgentProjectIds(orgPool, agentId) {
  await ensureCustomAgentsTables(orgPool);
  const resp = await orgPool.query(
    `SELECT project_id::text AS project_id
     FROM custom_agent_projects
     WHERE agent_id = $1`,
    [String(agentId)]
  );
  return (resp.rows || []).map((row) => String(row.project_id || '')).filter(Boolean);
}

async function ensureTaskAgentColumns(orgPool) {
  await orgPool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_source TEXT');
  await orgPool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_agent_id TEXT');
}

router.get('/', async (req, res, next) => {
  try {
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');
    await ensureCustomAgentsTables(req.orgDb);
    const projectId = safe(req.query.projectId);
    const runtime = getAgentsRuntime();
    const agents = await buildRoster(req.orgDb, runtime, projectId || null);
    return res.status(200).json({ agents });
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const name = safe(req.body?.name);
    const role = normalizeRole(req.body?.role);
    const projectIds = Array.isArray(req.body?.projectIds) ? req.body.projectIds.map((id) => safe(id)).filter(Boolean) : [];
    const dataSources = toTextArray(req.body?.dataSources);
    const triggerEvents = toTextArray(req.body?.triggerEvents);
    const triggerConditions = toTextArray(req.body?.triggerConditions);
    const actions = toTextArray(req.body?.actions);
    const autonomyLevel = Math.max(1, Math.min(3, Number(req.body?.autonomyLevel || 2)));
    const promptTemplate = safe(req.body?.promptTemplate || req.body?.contextMemo);
    const ragEnabled = dataSources.some((source) => {
      const lower = safe(source).toLowerCase();
      return lower.includes('rag') || lower.includes('documentation') || lower.includes('docs');
    });

    if (!name) return jsonError(res, 400, 'Bad request', 'name is required.');
    if (!projectIds.length) return jsonError(res, 400, 'Bad request', 'projectIds is required.');

    for (const projectId of projectIds) {
      const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
      if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);
    }

    await ensureCustomAgentsTables(req.orgDb);
    await ensureAgentConfigsTable(req.orgDb);

    const id = `${normalizeAgentId(name)}-${randomUUID().slice(0, 8)}`;

    await req.orgDb.query(
      `INSERT INTO custom_agents (
         id, name, role, data_sources, trigger_events, trigger_conditions, actions, autonomy_level, enabled, created_by
       ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,TRUE,$9)`,
      [
        id,
        name,
        role,
        JSON.stringify(dataSources),
        JSON.stringify(triggerEvents),
        JSON.stringify(triggerConditions),
        JSON.stringify(actions),
        autonomyLevel,
        String(req.user?.userId || ''),
      ]
    );

    for (const projectId of projectIds) {
      await req.orgDb.query(
        `INSERT INTO custom_agent_projects (agent_id, project_id)
         VALUES ($1,$2)
         ON CONFLICT (agent_id, project_id) DO NOTHING`,
        [id, projectId]
      );

      await req.orgDb.query(
        `INSERT INTO agent_configs (id, agent_type, project_id, trigger_settings, autonomy_level, constraints, context_memo, updated_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,NOW())
         ON CONFLICT (agent_type, project_id) DO UPDATE
         SET trigger_settings = EXCLUDED.trigger_settings,
             autonomy_level = EXCLUDED.autonomy_level,
             constraints = EXCLUDED.constraints,
             context_memo = EXCLUDED.context_memo,
             updated_at = NOW()`,
        [
          randomUUID(),
          id,
          projectId,
          JSON.stringify({ events: triggerEvents, conditions: triggerConditions }),
          autonomyLevel,
          JSON.stringify({ actions, dataSources, ragEnabled, promptTemplate }),
          promptTemplate || null,
        ]
      );
    }

    await insertAgentDecision(req.orgDb, {
      agentType: id,
      projectId: projectIds[0],
      actionDescription: 'Custom agent created',
      reasoning: { source: 'agent-control', actor: String(req.user?.userId || '') },
      dataUsed: { role, dataSources, triggerEvents, triggerConditions, actions, projectIds, autonomyLevel, ragEnabled, promptTemplate },
      status: 'executed',
      resolvedBy: String(req.user?.userId || ''),
      resolutionType: 'auto-executed',
    });

    return res.status(201).json({
      agent: {
        id,
        name,
        role,
        dataSources,
        triggerEvents,
        triggerConditions,
        actions,
        autonomyLevel,
        projectIds,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:agentId/status', async (req, res, next) => {
  try {
    const agentId = normalizeAgentId(req.params.agentId);
    const nextStatus = safe(req.body?.status).toLowerCase();
    const projectId = safe(req.body?.projectId || req.query.projectId);
    if (nextStatus !== 'active' && nextStatus !== 'paused') return jsonError(res, 400, 'Bad request', 'status must be active or paused.');
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const isBuiltIn = AGENT_CATALOG.some((item) => item.id === agentId);
    const customAgent = !isBuiltIn ? await getCustomAgentById(req.orgDb, agentId) : null;
    if (!isBuiltIn && !customAgent) return jsonError(res, 400, 'Bad request', 'Invalid agent id.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    if (!isBuiltIn) {
      const assigned = await isCustomAgentAssignedToProject(req.orgDb, agentId, projectId);
      if (!assigned) return jsonError(res, 403, 'Forbidden', 'Custom agent is not assigned to this project.');
      await req.orgDb.query(
        `UPDATE custom_agents
         SET enabled = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [agentId, nextStatus === 'active']
      );
    }

    await ensureAgentConfigsTable(req.orgDb);
    const constraints = { status: nextStatus };
    await req.orgDb.query(
      `INSERT INTO agent_configs (id, agent_type, project_id, trigger_settings, autonomy_level, constraints, context_memo, updated_at)
       VALUES ($1,$2,$3,'{}'::jsonb,2,$4::jsonb,NULL,NOW())
       ON CONFLICT (agent_type, project_id) DO UPDATE
       SET constraints = COALESCE(agent_configs.constraints, '{}'::jsonb) || EXCLUDED.constraints,
           updated_at = NOW()`,
      [randomUUID(), agentId, projectId, JSON.stringify(constraints)]
    );

    const runtime = getAgentsRuntime();
    const runtimeName = firstAgentHint(agentId);
    if (isBuiltIn && runtime && runtimeName && typeof runtime.setAgentPaused === 'function') {
      runtime.setAgentPaused(runtimeName, nextStatus === 'paused');
    }

    await insertAgentDecision(req.orgDb, {
      agentType: agentId,
      projectId,
      actionDescription: `Agent status changed to ${nextStatus}`,
      reasoning: { source: 'agent-control', actor: String(req.user?.userId || '') },
      dataUsed: { status: nextStatus },
      status: 'executed',
      resolvedBy: String(req.user?.userId || ''),
      resolutionType: 'auto-executed',
    });

    return res.status(200).json({ success: true, agentId, status: nextStatus });
  } catch (err) {
    return next(err);
  }
});

router.delete('/:agentId', async (req, res, next) => {
  try {
    const agentId = normalizeAgentId(req.params.agentId);
    const projectId = safe(req.query.projectId || req.body?.projectId);
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const customAgent = await getCustomAgentById(req.orgDb, agentId);
    if (!customAgent) return jsonError(res, 400, 'Bad request', 'Only custom agents can be deleted.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const assigned = await isCustomAgentAssignedToProject(req.orgDb, agentId, projectId);
    if (!assigned) return jsonError(res, 403, 'Forbidden', 'Custom agent is not assigned to this project.');

    await req.orgDb.query('DELETE FROM custom_agent_projects WHERE agent_id = $1 AND project_id = $2', [agentId, projectId]);
    await req.orgDb.query('DELETE FROM agent_configs WHERE agent_type = $1 AND project_id = $2', [agentId, projectId]);

    const remainingProjectIds = await listCustomAgentProjectIds(req.orgDb, agentId);
    if (!remainingProjectIds.length) {
      await req.orgDb.query('DELETE FROM custom_agents WHERE id = $1', [agentId]);
      await req.orgDb.query('DELETE FROM agent_configs WHERE agent_type = $1', [agentId]);
    }

    await insertAgentDecision(req.orgDb, {
      agentType: agentId,
      projectId,
      actionDescription: 'Custom agent removed from project',
      reasoning: { source: 'agent-control', actor: String(req.user?.userId || '') },
      dataUsed: { removedFromProject: projectId, deleted: !remainingProjectIds.length },
      status: 'executed',
      resolvedBy: String(req.user?.userId || ''),
      resolutionType: 'auto-executed',
    });

    return res.status(200).json({ success: true, agentId, removedFromProject: projectId, deleted: !remainingProjectIds.length });
  } catch (err) {
    return next(err);
  }
});

router.get('/:agentId/stats', async (req, res, next) => {
  try {
    const agentId = normalizeAgentId(req.params.agentId);
    const projectId = safe(req.query.projectId);
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const isBuiltIn = AGENT_CATALOG.some((item) => item.id === agentId);
    const customAgent = !isBuiltIn ? await getCustomAgentById(req.orgDb, agentId) : null;
    if (!isBuiltIn && !customAgent) return jsonError(res, 400, 'Bad request', 'Invalid agent id.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    if (!isBuiltIn) {
      const assigned = await isCustomAgentAssignedToProject(req.orgDb, agentId, projectId);
      if (!assigned) return jsonError(res, 403, 'Forbidden', 'Custom agent is not assigned to this project.');
    }

    await ensureTaskAgentColumns(req.orgDb);
    await ensureAgentDecisionsTable(req.orgDb);
    await ensureAgentActionsTable(req.orgDb);
    await ensureAgentConfigsTable(req.orgDb);

    const [taskAggResp, actionAggResp, decisionAggResp, cfgResp, createdTasksResp, createdTaskActionsRawResp, assignmentsRawResp] = await Promise.all([
      req.orgDb.query(
        `SELECT
           COUNT(*)::int AS tasks_created,
           COUNT(*) FILTER (WHERE status = 'done')::int AS tasks_completed,
           COUNT(*) FILTER (WHERE status IN ('todo','in_progress','in_review','blocked'))::int AS tasks_open,
           COUNT(*) FILTER (WHERE assignee_id IS NOT NULL)::int AS tasks_with_assignee,
           COUNT(DISTINCT assignee_id)::int FILTER (WHERE assignee_id IS NOT NULL) AS unique_developers_assigned
         FROM tasks
         WHERE project_id = $1
           AND created_agent_id = $2`,
        [projectId, agentId]
      ),
      req.orgDb.query(
        `SELECT
           COUNT(*)::int FILTER (WHERE action_name = 'create_task' AND status = 'executed') AS create_task_actions,
           COUNT(*)::int FILTER (WHERE action_name = 'assign_task' AND status = 'executed') AS assign_task_actions,
           COUNT(*)::int FILTER (WHERE status = 'failed') AS failed_actions,
           COUNT(*)::int AS total_actions
         FROM agent_actions
         WHERE project_id = $1
           AND agent_type = $2`,
        [projectId, agentId]
      ),
      req.orgDb.query(
        `SELECT
           COUNT(*)::int AS total_decisions,
           COUNT(*)::int FILTER (WHERE status = 'executed') AS executed_decisions,
           COUNT(*)::int FILTER (WHERE status = 'failed') AS failed_decisions
         FROM agent_decisions
         WHERE project_id = $1
           AND agent_type = $2`,
        [projectId, agentId]
      ),
      req.orgDb.query(
        `SELECT constraints
         FROM agent_configs
         WHERE project_id = $1 AND agent_type = $2
         LIMIT 1`,
        [projectId, agentId]
      ),
      req.orgDb.query(
        `SELECT
           t.id,
           t.title,
           t.status,
           t.priority,
           t.created_at,
           COALESCE(tm.full_name, 'Unassigned') AS assignee_name
         FROM tasks t
         LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
         LEFT JOIN team_members tm ON tm.id = dp.member_id
         WHERE t.project_id = $1
           AND t.created_agent_id = $2
         ORDER BY t.created_at DESC
         LIMIT 30`,
        [projectId, agentId]
      ),
      req.orgDb.query(
        `SELECT id, input, result, entity_id
         FROM agent_actions
         WHERE project_id = $1
           AND agent_type = $2
           AND action_name = 'create_task'
           AND status = 'executed'
         ORDER BY created_at DESC
         LIMIT 100`,
        [projectId, agentId]
      ),
      req.orgDb.query(
        `SELECT id, created_at, input, result, entity_id
         FROM agent_actions
         WHERE project_id = $1
           AND agent_type = $2
           AND action_name = 'assign_task'
           AND status = 'executed'
         ORDER BY created_at DESC
         LIMIT 30`,
        [projectId, agentId]
      ),
    ]);

    const taskAgg = taskAggResp.rows[0] || {};
    const actionAgg = actionAggResp.rows[0] || {};
    const decisionAgg = decisionAggResp.rows[0] || {};
    const constraints = cfgResp.rows[0]?.constraints || {};
    const createdTasksByAgent = (createdTasksResp.rows || []).map((row) => ({
      id: String(row.id || ''),
      title: String(row.title || ''),
      status: String(row.status || ''),
      priority: String(row.priority || ''),
      assignee: String(row.assignee_name || 'Unassigned'),
      createdAt: row.created_at || null,
    }));

    const createdTaskActionRows = createdTaskActionsRawResp.rows || [];
    const createdTaskIdsFromActions = [
      ...new Set(
        createdTaskActionRows
          .map((row) => {
            const input = parseJsonish(row.input);
            const result = parseJsonish(row.result);
            return safe(result?.taskId || result?.id || input?.taskId || row.entity_id);
          })
          .filter(Boolean)
      ),
    ];

    const createdTasksFallbackResp = createdTaskIdsFromActions.length
      ? await req.orgDb.query(
          `SELECT
             t.id,
             t.title,
             t.status,
             t.priority,
             t.created_at,
             COALESCE(tm.full_name, 'Unassigned') AS assignee_name
           FROM tasks t
           LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
           LEFT JOIN team_members tm ON tm.id = dp.member_id
           WHERE t.project_id = $1
             AND t.id::text = ANY($2::text[])
           ORDER BY t.created_at DESC
           LIMIT 30`,
          [projectId, createdTaskIdsFromActions]
        )
      : { rows: [] };

    const createdTasksMerged = [
      ...createdTasksByAgent,
      ...(createdTasksFallbackResp.rows || []).map((row) => ({
        id: String(row.id || ''),
        title: String(row.title || ''),
        status: String(row.status || ''),
        priority: String(row.priority || ''),
        assignee: String(row.assignee_name || 'Unassigned'),
        createdAt: row.created_at || null,
      })),
    ];

    const createdTaskDedupMap = new Map();
    for (const row of createdTasksMerged) {
      const id = safe(row.id);
      if (!id || createdTaskDedupMap.has(id)) continue;
      createdTaskDedupMap.set(id, row);
    }
    const createdTasks = [...createdTaskDedupMap.values()].slice(0, 30);
    const assignmentRows = assignmentsRawResp.rows || [];
    const parsedAssignments = assignmentRows.map((row) => {
      const input = parseJsonish(row.input);
      const result = parseJsonish(row.result);
      return {
        id: String(row.id || ''),
        taskId: safe(result?.taskId || result?.id || input?.taskId || row.entity_id),
        developerId: safe(input?.developerId || result?.developerId || result?.assignedTo),
        developerName: safe(result?.developerName || result?.assigneeName),
        createdAt: row.created_at || null,
      };
    });

    const assignmentsFallbackResp = !parsedAssignments.length
      ? await req.orgDb.query(
          `SELECT
             t.id::text AS task_id,
             t.title AS task_title,
             COALESCE(tm.full_name, '') AS developer_name,
             COALESCE(t.updated_at, t.created_at) AS created_at
           FROM tasks t
           LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
           LEFT JOIN team_members tm ON tm.id = dp.member_id
           WHERE t.project_id = $1
             AND t.created_agent_id = $2
             AND t.assignee_id IS NOT NULL
           ORDER BY COALESCE(t.updated_at, t.created_at) DESC
           LIMIT 30`,
          [projectId, agentId]
        )
      : { rows: [] };

    const taskIds = [...new Set(parsedAssignments.map((x) => x.taskId).filter(Boolean))];
    const developerIds = [...new Set(parsedAssignments.map((x) => x.developerId).filter(Boolean))];

    const [taskTitlesResp, devNamesResp] = await Promise.all([
      taskIds.length
        ? req.orgDb.query(
            `SELECT id::text AS id, title
             FROM tasks
             WHERE id::text = ANY($1::text[])`,
            [taskIds]
          )
        : Promise.resolve({ rows: [] }),
      developerIds.length
        ? req.orgDb.query(
            `SELECT dp.id::text AS id, COALESCE(tm.full_name, '') AS name
             FROM developer_profiles dp
             LEFT JOIN team_members tm ON tm.id = dp.member_id
             WHERE dp.id::text = ANY($1::text[])`,
            [developerIds]
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const taskTitleMap = new Map((taskTitlesResp.rows || []).map((row) => [String(row.id || ''), String(row.title || '')]));
    const devNameMap = new Map((devNamesResp.rows || []).map((row) => [String(row.id || ''), String(row.name || '')]));

    const assignmentsFromActions = parsedAssignments.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      taskTitle: taskTitleMap.get(row.taskId) || '',
      developer: row.developerName || devNameMap.get(row.developerId) || '',
      createdAt: row.createdAt,
    }));

    const assignmentsFallback = (assignmentsFallbackResp.rows || []).map((row, idx) => ({
      id: `fallback:${idx}:${safe(row.task_id)}`,
      taskId: safe(row.task_id),
      taskTitle: safe(row.task_title),
      developer: safe(row.developer_name),
      createdAt: row.created_at || null,
    }));

    const assignmentDedup = new Map();
    for (const row of [...assignmentsFromActions, ...assignmentsFallback]) {
      const key = `${safe(row.taskId)}:${safe(row.developer)}`;
      if (!safe(row.taskId) || assignmentDedup.has(key)) continue;
      assignmentDedup.set(key, row);
    }
    const assignments = [...assignmentDedup.values()].slice(0, 30);
    const inngestEndpoint = getInngestEventEndpoint();
    const isProduction = safe(process.env.NODE_ENV).toLowerCase() === 'production';
    const aiServiceEndpoint = safe(process.env.AI_SERVICE_URL) || (isProduction ? '' : 'http://127.0.0.1:8000');

    let ragMigrationReady = false;
    let ragMigrationDetail = 'not-checked';
    try {
      await ensureEmbeddingsInfrastructure();
      ragMigrationReady = true;
      ragMigrationDetail = 'ready';
    } catch (err) {
      ragMigrationReady = false;
      ragMigrationDetail = safe(err?.message) || 'failed';
    }

    const tasksCreatedFallback = createdTasks.length;
    const tasksCreatedAgg = Number(taskAgg.tasks_created || 0);
    const effectiveTasksCreated = Math.max(tasksCreatedAgg, tasksCreatedFallback);
    const tasksCompletedFallback = createdTasks.filter((row) => safe(row.status).toLowerCase() === 'done').length;
    const tasksOpenFallback = createdTasks.filter((row) => ['todo', 'in_progress', 'in_review', 'blocked'].includes(safe(row.status).toLowerCase())).length;
    const tasksWithAssigneeFallback = createdTasks.filter((row) => safe(row.assignee).toLowerCase() !== 'unassigned').length;

    return res.status(200).json({
      stats: {
        tasksCreated: effectiveTasksCreated,
        tasksCompleted: Math.max(Number(taskAgg.tasks_completed || 0), tasksCompletedFallback),
        tasksOpen: Math.max(Number(taskAgg.tasks_open || 0), tasksOpenFallback),
        tasksWithAssignee: Math.max(Number(taskAgg.tasks_with_assignee || 0), tasksWithAssigneeFallback),
        uniqueDevelopersAssigned: Number(taskAgg.unique_developers_assigned || 0),
        createTaskActions: Number(actionAgg.create_task_actions || 0),
        assignTaskActions: Number(actionAgg.assign_task_actions || 0),
        totalActions: Number(actionAgg.total_actions || 0),
        failedActions: Number(actionAgg.failed_actions || 0),
        totalDecisions: Number(decisionAgg.total_decisions || 0),
        executedDecisions: Number(decisionAgg.executed_decisions || 0),
        failedDecisions: Number(decisionAgg.failed_decisions || 0),
        ragEnabled: Boolean(constraints?.ragEnabled),
        promptTemplateDefined: Boolean(safe(constraints?.promptTemplate)),
        aiServiceConfigured: Boolean(aiServiceEndpoint),
        aiServiceEndpoint: aiServiceEndpoint || 'missing',
        inngestConfigured: Boolean(inngestEndpoint),
        inngestEndpoint: inngestEndpoint ? 'configured' : 'missing',
        ragMigrationReady,
        ragMigrationDetail,
        createdTasks,
        assignments,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:agentId/run', async (req, res, next) => {
  try {
    const agentId = normalizeAgentId(req.params.agentId);
    const projectId = safe(req.body?.projectId || req.query.projectId);
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const customAgent = await getCustomAgentById(req.orgDb, agentId);
    if (!customAgent) return jsonError(res, 400, 'Bad request', 'Only custom agents can be manually run.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const assigned = await isCustomAgentAssignedToProject(req.orgDb, agentId, projectId);
    if (!assigned) return jsonError(res, 403, 'Forbidden', 'Custom agent is not assigned to this project.');

    const cfgResp = await req.orgDb.query(
      `SELECT context_memo, constraints
       FROM agent_configs
       WHERE project_id = $1 AND agent_type = $2
       LIMIT 1`,
      [projectId, agentId]
    );
    const cfgConstraints = parseJsonish(cfgResp.rows[0]?.constraints);
    const prompt = safe(cfgResp.rows[0]?.context_memo || req.body?.promptTemplate || customAgent.name);
    const role = safe(customAgent.role || 'custom');
    const requestedTaskCountRaw = Number(req.body?.taskCount);
    const requestedTaskCount = Number.isFinite(requestedTaskCountRaw)
      ? Math.max(2, Math.min(8, Math.floor(requestedTaskCountRaw)))
      : 3;

    const sprintResp = await req.orgDb.query(
      `SELECT id
       FROM sprints
       WHERE project_id = $1 AND status IN ('active', 'planning')
       ORDER BY start_date DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [projectId]
    );
    let sprintId = safe(sprintResp.rows[0]?.id);

    const context = {
      projectId,
      userId: String(req.user?.userId || ''),
      orgId: String(req.user?.orgId || ''),
      executionMode: 'auto',
      agentId,
    };

    const selectedDataSources = toTextArray(customAgent.data_sources).map((item) => item.toLowerCase());
    const selectedActions = toTextArray(customAgent.actions).map((item) => item.toLowerCase());
    const notificationTargets = [
      ...toTextArray(cfgConstraints?.notificationTargets),
      ...toTextArray(req.body?.notificationTargets || req.body?.notificationEmails),
    ]
      .map((value) => safe(value).toLowerCase())
      .filter((value) => value.includes('@'));

    const projectGithubResp = await req.orgDb.query(
      `SELECT TRIM(github_repo) AS github_repo
       FROM projects
       WHERE id = $1
       LIMIT 1`,
      [projectId]
    );
    const githubRepo = safe(projectGithubResp.rows[0]?.github_repo || '');
    const shouldMirrorToGithub =
      Boolean(githubRepo) &&
      ((role === 'task-generator' || role === 'custom') ||
        selectedDataSources.some((item) => item.includes('github')) ||
        selectedActions.some((item) => item.includes('github')));

    const createdTasks = [];
    const assignedTasks = [];
    const githubIssues = [];
    const githubIssueErrors = [];
    let monitoringEmail = null;

    if ((role === 'task-generator' || role === 'custom') && !sprintId) {
      const start = new Date();
      const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const createdSprint = await executeActionWithPolicy(req.orgDb, context, 'create_sprint', {
        name: `Auto Sprint ${start.toISOString().slice(0, 10)}`,
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        goal: `Auto sprint generated for ${customAgent.name}`,
      });
      sprintId = safe(createdSprint?.sprintId || createdSprint?.id);
    }

    if ((role === 'task-generator' || role === 'custom') && sprintId) {
      const aiBaseUrl = safe(process.env.AI_SERVICE_URL) || (safe(process.env.NODE_ENV).toLowerCase() === 'production' ? '' : 'http://127.0.0.1:8000');
      let aiTaskTitles = [];

      if (aiBaseUrl) {
        try {
          const aiResp = await axios.post(
            `${String(aiBaseUrl).replace(/\/+$/, '')}/autonomous/autopilot`,
            {
              projectId,
              prompt,
              taskCount: requestedTaskCount,
              mode: 'task-generation',
            },
            {
              timeout: 20_000,
              validateStatus: () => true,
            }
          );

          if (aiResp.status >= 200 && aiResp.status < 300) {
            const proposed = Array.isArray(aiResp.data?.proposedTasks)
              ? aiResp.data.proposedTasks
              : Array.isArray(aiResp.data?.tasks)
                ? aiResp.data.tasks
                : [];
            aiTaskTitles = proposed
              .map((row) => safe(row?.title || row?.name || row?.taskTitle))
              .filter(Boolean)
              .slice(0, requestedTaskCount);
          }
        } catch {
          // Fall back to prompt-based generation when AI service is unavailable.
        }
      }

      const lines = prompt
        .split(/\r?\n/)
        .map((line) => safe(line.replace(/^[-*\d.)\s]+/, '')))
        .filter(Boolean)
        .slice(0, requestedTaskCount);
      const taskTitles = aiTaskTitles.length ? [...aiTaskTitles] : lines.length ? [...lines] : [];
      while (taskTitles.length < requestedTaskCount) {
        taskTitles.push(`${customAgent.name} task ${taskTitles.length + 1}`);
      }

      for (const title of taskTitles) {
        const createdTask = await executeActionWithPolicy(req.orgDb, context, 'create_task', {
          sprintId,
          title,
          description: `Generated by ${customAgent.name}: ${prompt.slice(0, 240)}`,
          priority: 'medium',
          storyPoints: 2,
        });

        let githubIssue = null;
        if (shouldMirrorToGithub) {
          try {
            githubIssue = await executeActionWithPolicy(req.orgDb, context, 'create_github_issue', {
              title,
              body: `Generated by ${customAgent.name}\n\nTask: ${createdTask?.url || ''}`,
              labels: ['ai-agent', 'task'],
            });
            if (githubIssue?.url) githubIssues.push(githubIssue);
          } catch (err) {
            githubIssueErrors.push({
              title,
              detail: safe(err?.message) || 'Failed to mirror issue to GitHub.',
            });
            // GitHub mirroring is optional and should not fail task generation.
          }
        }

        createdTasks.push({ ...createdTask, githubIssue });
      }
    }

    if (role === 'assignment' || role === 'custom') {
      const createdTaskIds = createdTasks
        .map((row) => safe(row?.taskId || row?.id))
        .filter(Boolean);

      const unassignedResp = await req.orgDb.query(
        `SELECT id, sprint_id, story_points, tech_tags, priority
         FROM tasks
         WHERE project_id = $1
           AND COALESCE(status, 'todo') IN ('todo','in_progress')
           AND assignee_id IS NULL
         ORDER BY created_at ASC
         LIMIT 8`,
        [projectId]
      );

      const queueById = new Map();
      for (const row of unassignedResp.rows || []) {
        const taskId = safe(row.id);
        if (!taskId) continue;
        queueById.set(taskId, row);
      }

      if (createdTaskIds.length) {
        const createdRowsResp = await req.orgDb.query(
          `SELECT id, sprint_id, story_points, tech_tags, priority
           FROM tasks
           WHERE id::text = ANY($1::text[])`,
          [createdTaskIds]
        );
        for (const row of createdRowsResp.rows || []) {
          const taskId = safe(row.id);
          if (!taskId) continue;
          queueById.set(taskId, row);
        }
      }

      const queue = [...queueById.values()].slice(0, 8);
      let lastDeveloperId = '';

      for (const row of queue) {
        const taskId = safe(row.id);
        const sprintForTask = safe(row.sprint_id || sprintId);
        if (!taskId || !sprintForTask) continue;
        try {
          const assignment = await assignmentService.assign(
            req,
            {
              taskId,
              sprintId: sprintForTask,
              techTags: Array.isArray(row.tech_tags) ? row.tech_tags : [],
              storyPoints: Number(row.story_points || 0),
              priority: safe(row.priority || 'medium'),
            },
            { excludeDeveloperId: lastDeveloperId || undefined }
          );

          if (assignment?.assigned && assignment?.developer?.id) {
            lastDeveloperId = safe(assignment.developer.id);
            assignedTasks.push({
              taskId,
              developerId: safe(assignment.developer.id),
              developerName: safe(assignment.developer.name),
              reason: safe(assignment.reason),
            });
          }
        } catch {
          // Keep run resilient even when assignment fails for specific tasks.
        }
      }
    }

    if (role === 'monitoring' || selectedActions.some((item) => item.includes('alert') || item.includes('email'))) {
      const monitoringAggResp = await req.orgDb.query(
        `SELECT
           COUNT(*)::int FILTER (WHERE status = 'blocked') AS blocked_count,
           COUNT(*)::int FILTER (WHERE status = 'in_review') AS in_review_count,
           COUNT(*)::int FILTER (WHERE status IN ('todo','in_progress','in_review','blocked')) AS open_count,
           COUNT(*)::int FILTER (WHERE status = 'done') AS done_count
         FROM tasks
         WHERE project_id = $1`,
        [projectId]
      );
      const monitoringAgg = monitoringAggResp.rows[0] || {};

      const blockedTasksResp = await req.orgDb.query(
        `SELECT title
         FROM tasks
         WHERE project_id = $1
           AND status = 'blocked'
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 5`,
        [projectId]
      );

      if (notificationTargets.length && emailService.isConfigured()) {
        const blockedTitles = (blockedTasksResp.rows || [])
          .map((row) => safe(row.title))
          .filter(Boolean);

        const subject = `[Monitoring] ${customAgent.name} alert for project ${projectId}`;
        const htmlContent = `
          <div style="font-family:Arial,sans-serif;line-height:1.5;">
            <h2>Monitoring Alert</h2>
            <p>Agent <strong>${customAgent.name}</strong> reported project health summary.</p>
            <ul>
              <li>Blocked tasks: <strong>${Number(monitoringAgg.blocked_count || 0)}</strong></li>
              <li>In review: <strong>${Number(monitoringAgg.in_review_count || 0)}</strong></li>
              <li>Open tasks: <strong>${Number(monitoringAgg.open_count || 0)}</strong></li>
              <li>Done tasks: <strong>${Number(monitoringAgg.done_count || 0)}</strong></li>
            </ul>
            <p>Top blocked items:</p>
            <ul>${blockedTitles.map((title) => `<li>${title}</li>`).join('') || '<li>No blocked items</li>'}</ul>
          </div>
        `;
        const textContent = [
          `Monitoring Alert - ${customAgent.name}`,
          `Blocked: ${Number(monitoringAgg.blocked_count || 0)}`,
          `In review: ${Number(monitoringAgg.in_review_count || 0)}`,
          `Open: ${Number(monitoringAgg.open_count || 0)}`,
          `Done: ${Number(monitoringAgg.done_count || 0)}`,
          `Blocked items: ${blockedTitles.join(' | ') || 'None'}`,
        ].join('\n');

        try {
          const sendResult = await emailService.sendTransactionalEmail({
            to: notificationTargets.map((email) => ({ email })),
            subject,
            htmlContent,
            textContent,
          });
          monitoringEmail = {
            attempted: true,
            sent: Boolean(sendResult?.sent),
            recipients: notificationTargets,
            blockedCount: Number(monitoringAgg.blocked_count || 0),
          };
        } catch (err) {
          monitoringEmail = {
            attempted: true,
            sent: false,
            recipients: notificationTargets,
            blockedCount: Number(monitoringAgg.blocked_count || 0),
            error: safe(err?.message) || 'Failed to send monitoring email.',
          };
        }
      } else {
        monitoringEmail = {
          attempted: false,
          sent: false,
          recipients: notificationTargets,
          blockedCount: Number(monitoringAgg.blocked_count || 0),
          detail: notificationTargets.length ? 'Email service is not configured.' : 'No notification targets configured.',
        };
      }
    }

    try {
      await sendInngestEvent('agent/custom.run', {
        orgId: String(req.user?.orgId || ''),
        projectId,
        agentId,
        createdTasks: createdTasks.length,
        assignedTasks: assignedTasks.length,
      });
    } catch {
      // Do not fail manual runs when event forwarding is unavailable.
    }

    await insertAgentDecision(req.orgDb, {
      agentType: agentId,
      projectId,
      actionDescription: 'Custom agent run executed',
      reasoning: { source: 'manual-run', actor: String(req.user?.userId || ''), prompt },
      dataUsed: { role, prompt, createdTasks: createdTasks.length, assignedTasks: assignedTasks.length, monitoringEmail },
      status: 'executed',
      resolvedBy: String(req.user?.userId || ''),
      resolutionType: 'auto-executed',
    });

    return res.status(200).json({
      success: true,
      createdTasks,
      assignedTasks,
      monitoringEmail,
      githubIssues,
      githubIssueErrors,
      githubRepo: githubRepo || null,
      detail: `Run complete. Created ${createdTasks.length} task(s), assigned ${assignedTasks.length} task(s), mirrored ${githubIssues.length} issue(s) to GitHub${monitoringEmail?.attempted ? ', and processed monitoring email alerts' : ''}.`,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/:agentId/config', async (req, res, next) => {
  try {
    const agentId = normalizeAgentId(req.params.agentId);
    const projectId = safe(req.query.projectId);
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const isBuiltIn = AGENT_CATALOG.some((item) => item.id === agentId);
    const customAgent = !isBuiltIn ? await getCustomAgentById(req.orgDb, agentId) : null;
    if (!isBuiltIn && !customAgent) return jsonError(res, 400, 'Bad request', 'Invalid agent id.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    if (!isBuiltIn) {
      const assigned = await isCustomAgentAssignedToProject(req.orgDb, agentId, projectId);
      if (!assigned) return jsonError(res, 403, 'Forbidden', 'Custom agent is not assigned to this project.');
    }

    await ensureAgentConfigsTable(req.orgDb);
    const resp = await req.orgDb.query(
      `SELECT agent_type, project_id, trigger_settings, autonomy_level, constraints, context_memo, updated_at
       FROM agent_configs
       WHERE agent_type = $1 AND project_id = $2
       LIMIT 1`,
      [agentId, projectId]
    );

    const row = resp.rows[0] || null;
    const config = row || {
      agent_type: agentId,
      project_id: projectId,
      trigger_settings: {
        schedule: { enabled: true, mode: 'every_n_hours', everyHours: 4, dailyAt: '09:00' },
        events: { taskCreated: true, sprintStarted: true, prMerged: false },
        thresholds: { riskScoreGt: 75, developerLoadGt: 85 },
      },
      autonomy_level: 2,
      constraints: { maxTasksPerRun: 5, blockedDevelopers: [], protectedSprints: [], notificationTargets: [] },
      context_memo: '',
      updated_at: null,
    };

    if (!isBuiltIn && customAgent && !row) {
      config.trigger_settings = {
        schedule: { enabled: false, mode: 'event' },
        events: { customEvents: Array.isArray(customAgent.trigger_events) ? customAgent.trigger_events : [] },
        thresholds: { conditions: Array.isArray(customAgent.trigger_conditions) ? customAgent.trigger_conditions : [] },
      };
      config.autonomy_level = Number(customAgent.autonomy_level || 2);
      config.constraints = {
        actions: Array.isArray(customAgent.actions) ? customAgent.actions : [],
        dataSources: Array.isArray(customAgent.data_sources) ? customAgent.data_sources : [],
      };
      config.context_memo = safe(customAgent.name || '');
    }

    return res.status(200).json({ config });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:agentId/config', async (req, res, next) => {
  try {
    const agentId = normalizeAgentId(req.params.agentId);
    const projectId = safe(req.body?.projectId || req.query.projectId);
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const isBuiltIn = AGENT_CATALOG.some((item) => item.id === agentId);
    const customAgent = !isBuiltIn ? await getCustomAgentById(req.orgDb, agentId) : null;
    if (!isBuiltIn && !customAgent) return jsonError(res, 400, 'Bad request', 'Invalid agent id.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    if (!isBuiltIn) {
      const assigned = await isCustomAgentAssignedToProject(req.orgDb, agentId, projectId);
      if (!assigned) return jsonError(res, 403, 'Forbidden', 'Custom agent is not assigned to this project.');
    }

    const triggerSettings = req.body?.triggerSettings && typeof req.body.triggerSettings === 'object' ? req.body.triggerSettings : {};
    const autonomyLevel = Math.max(1, Math.min(3, Number(req.body?.autonomyLevel || 2)));
    const constraints = req.body?.constraints && typeof req.body.constraints === 'object' ? req.body.constraints : {};
    const contextMemo = safe(req.body?.contextMemo);

    await ensureAgentConfigsTable(req.orgDb);
    await req.orgDb.query(
      `INSERT INTO agent_configs (id, agent_type, project_id, trigger_settings, autonomy_level, constraints, context_memo, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,NOW())
       ON CONFLICT (agent_type, project_id) DO UPDATE
       SET trigger_settings = EXCLUDED.trigger_settings,
           autonomy_level = EXCLUDED.autonomy_level,
           constraints = EXCLUDED.constraints,
           context_memo = EXCLUDED.context_memo,
           updated_at = NOW()`,
      [randomUUID(), agentId, projectId, JSON.stringify(triggerSettings), autonomyLevel, JSON.stringify(constraints), contextMemo || null]
    );

    await insertAgentDecision(req.orgDb, {
      agentType: agentId,
      projectId,
      actionDescription: 'Configuration updated',
      reasoning: { source: 'agent-control', actor: String(req.user?.userId || '') },
      dataUsed: { triggerSettings, autonomyLevel, constraints },
      status: 'executed',
      resolvedBy: String(req.user?.userId || ''),
      resolutionType: 'modified',
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
});

router.get('/decisions', async (req, res, next) => {
  try {
    const projectId = safe(req.query.projectId);
    const agentType = normalizeAgentId(req.query.agentType || '');
    const resolutionType = safe(req.query.resolutionType).toLowerCase();
    const fromDate = safe(req.query.fromDate);
    const toDate = safe(req.query.toDate);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = 20;
    const offset = (page - 1) * pageSize;
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    await ensureAgentDecisionsTable(req.orgDb);
    const query =
      `SELECT id, agent_type, project_id, action_description, reasoning, confidence, data_used, status, resolved_by, resolved_at, resolution_type, created_at
       FROM agent_decisions
       WHERE ($1::text = '' OR project_id = $1)
         AND ($2::text = '' OR agent_type = $2)
         AND ($3::text = '' OR LOWER(COALESCE(resolution_type, '')) = $3)
         AND ($4::text = '' OR created_at >= $4::timestamptz)
         AND ($5::text = '' OR created_at <= $5::timestamptz)
       ORDER BY created_at DESC
       LIMIT $6 OFFSET $7`;

    const resp = await req.orgDb.query(query, [projectId, agentType, resolutionType, fromDate, toDate, pageSize, offset]);
    return res.status(200).json({ items: resp.rows, page, pageSize });
  } catch (err) {
    return next(err);
  }
});

router.get('/:agentId/decisions', async (req, res, next) => {
  try {
    const agentId = normalizeAgentId(req.params.agentId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const projectId = safe(req.query.projectId);
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const isBuiltIn = AGENT_CATALOG.some((item) => item.id === agentId);
    const customAgent = !isBuiltIn ? await getCustomAgentById(req.orgDb, agentId) : null;
    if (!isBuiltIn && !customAgent) return jsonError(res, 400, 'Bad request', 'Invalid agent id.');

    await ensureAgentDecisionsTable(req.orgDb);
    const pageSize = 20;
    const offset = (page - 1) * pageSize;
    const resp = await req.orgDb.query(
      `SELECT id, agent_type, project_id, action_description, reasoning, confidence, data_used, status, resolved_by, resolved_at, resolution_type, created_at
       FROM agent_decisions
       WHERE agent_type = $1
         AND ($2::text = '' OR project_id = $2)
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [agentId, projectId, pageSize, offset]
    );

    let items = resp.rows || [];

    if (!items.length) {
      const actionsFallbackResp = await req.orgDb.query(
        `SELECT id, action_name, status, created_at, input, result
         FROM agent_actions
         WHERE agent_type = $1
           AND ($2::text = '' OR project_id::text = $2::text)
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [agentId, projectId, pageSize, offset]
      );

      items = (actionsFallbackResp.rows || []).map((row) => ({
        id: row.id,
        agent_type: agentId,
        project_id: projectId || null,
        action_description: safe(row.action_name || 'action'),
        reasoning: '',
        confidence: null,
        data_used: parseJsonish(row.input) || {},
        status: safe(row.status || 'executed'),
        resolved_by: null,
        resolved_at: null,
        resolution_type: 'action-fallback',
        created_at: row.created_at,
        result: parseJsonish(row.result) || {},
      }));
    }

    return res.status(200).json({ items, page, pageSize });
  } catch (err) {
    return next(err);
  }
});

router.get('/status', async (req, res, next) => {
  try {
    if (!req.orgDb) {
      return res.status(500).json({ error: 'Server error', code: 500, detail: 'Org database is not available.' });
    }

    const runtime = getAgentsRuntime();
    if (!runtime) {
      return res.status(200).json({ agents: [] });
    }

    const runtimeAgents = await runtime.getStatus(req.orgDb);
    const runMap = await getAgentRunMap(req.orgDb);
    const agents = (runtimeAgents || []).map((agent) => {
      const key = String(agent?.name || '');
      const row = runMap.get(key);
      return {
        ...agent,
        last_run: row?.last_run || null,
        next_run: row?.next_run || null,
        action_count_today: Number(row?.action_count_today || 0),
      };
    });
    return res.status(200).json({ agents });
  } catch (err) {
    return next(err);
  }
});

router.patch('/pause-all', async (req, res, next) => {
  try {
    const paused = Boolean(req.body?.paused);
    const runtime = getAgentsRuntime();
    if (!runtime || typeof runtime.setAllPaused !== 'function') {
      return jsonError(res, 503, 'Service unavailable', 'Agent runtime is not available.');
    }
    runtime.setAllPaused(paused);
    return res.status(200).json({ success: true, paused });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:agentName/pause', async (req, res, next) => {
  try {
    const agentName = safe(req.params.agentName);
    const paused = Boolean(req.body?.paused);
    if (!agentName) return jsonError(res, 400, 'Bad request', 'agentName is required.');

    const runtime = getAgentsRuntime();
    if (!runtime || typeof runtime.setAgentPaused !== 'function') {
      return jsonError(res, 503, 'Service unavailable', 'Agent runtime is not available.');
    }

    const ok = runtime.setAgentPaused(agentName, paused);
    if (!ok) return jsonError(res, 400, 'Bad request', 'Invalid agent name.');
    return res.status(200).json({ success: true, agentName, paused });
  } catch (err) {
    return next(err);
  }
});

router.get('/approvals', async (req, res, next) => {
  try {
    const projectId = safe(req.query.projectId);
    const status = safe(req.query.status).toLowerCase();
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    await ensureAgentApprovalsTable(req.orgDb);
    const allowedStatus = new Set(['pending', 'approved', 'rejected', 'failed']);
    const hasStatusFilter = allowedStatus.has(status);
    const resp = hasStatusFilter
      ? await req.orgDb.query(
          `SELECT id, project_id, action_type, title, description, payload, status, decided_by, decided_at, created_at
           FROM agent_approvals
           WHERE project_id = $1 AND status = $2
           ORDER BY created_at DESC
           LIMIT 100`,
          [projectId, status]
        )
      : await req.orgDb.query(
          `SELECT id, project_id, action_type, title, description, payload, status, decided_by, decided_at, created_at
           FROM agent_approvals
           WHERE project_id = $1
           ORDER BY created_at DESC
           LIMIT 100`,
          [projectId]
        );

    return res.status(200).json({ approvals: resp.rows });
  } catch (err) {
    return next(err);
  }
});

router.post('/approvals', async (req, res, next) => {
  try {
    const projectId = safe(req.body?.projectId);
    const actionType = safe(req.body?.actionType || req.body?.action_type);
    const title = safe(req.body?.title);
    const description = safe(req.body?.description);
    const payload = req.body?.payload || {};

    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!actionType) return jsonError(res, 400, 'Bad request', 'actionType is required.');
    if (!title) return jsonError(res, 400, 'Bad request', 'title is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const id = randomUUID();
    await ensureAgentApprovalsTable(req.orgDb);
    await ensureAgentActionsTable(req.orgDb);

    await req.orgDb.query(
      `INSERT INTO agent_approvals (id, project_id, action_type, title, description, payload, status)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,'pending')`,
      [id, projectId, actionType, title, description || null, JSON.stringify(payload)]
    );

    await req.orgDb.query(
      `INSERT INTO agent_actions (id, project_id, user_id, action_name, input, result, status)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'pending_approval')`,
      [id, projectId, String(req.user?.userId || ''), actionType, JSON.stringify(payload?.input || {}), JSON.stringify({ title, description })]
    );

    emitToProject(projectId, 'agent:approval', {
      id,
      projectId,
      actionType,
      title,
      description,
      payload,
      status: 'pending',
    });

    return res.status(201).json({ success: true, id });
  } catch (err) {
    return next(err);
  }
});

router.get('/actions', async (req, res, next) => {
  try {
    const projectId = safe(req.query.projectId);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 25, 100));
    const source = safe(req.query.source).toLowerCase();
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    await ensureAgentActionsTable(req.orgDb);
    const resp = source
      ? await req.orgDb.query(
          `SELECT id, project_id, user_id, action_name, action, entity_type, entity_id, input, payload, result, status, source, created_at
           FROM agent_actions
           WHERE project_id = $1 AND LOWER(COALESCE(source::text, '')) = $2
           ORDER BY created_at DESC
           LIMIT $3`,
          [projectId, source, limit]
        )
      : await req.orgDb.query(
          `SELECT id, project_id, user_id, action_name, action, entity_type, entity_id, input, payload, result, status, source, created_at
           FROM agent_actions
           WHERE project_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [projectId, limit]
        );

    return res.status(200).json({ items: resp.rows });
  } catch (err) {
    return next(err);
  }
});

router.patch('/approvals/:id/approve', async (req, res, next) => {
  try {
    const approvalId = safe(req.params.id);
    if (!approvalId) return jsonError(res, 400, 'Bad request', 'approval id is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    await ensureAgentApprovalsTable(req.orgDb);
    await ensureAgentActionsTable(req.orgDb);

    const rowResp = await req.orgDb.query(
      `SELECT id, project_id, action_type, payload, status
       FROM agent_approvals
       WHERE id = $1
       LIMIT 1`,
      [approvalId]
    );
    const approval = rowResp.rows[0];
    if (!approval) return jsonError(res, 404, 'Not found', 'Approval request not found.');
    if (safe(approval.status) !== 'pending') return jsonError(res, 409, 'Conflict', 'Approval has already been decided.');

    const projectId = safe(approval.project_id);
    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const payload = approval.payload || {};
    const actionType = safe(payload.actionType || approval.action_type);
    const input = payload.input || {};
    if (!actionType) return jsonError(res, 422, 'Unprocessable entity', 'Approval payload is missing action type.');

    let result;
    try {
      result = await executeCoreAction(req.orgDb, {
        projectId,
        userId: String(req.user?.userId || ''),
        executionMode: 'auto',
      }, actionType, input);
    } catch (err) {
      const detail = safe(err?.message) || 'Action execution failed after approval.';
      await req.orgDb.query(
        `UPDATE agent_approvals
         SET status = 'failed', decided_by = $2, decided_at = NOW()
         WHERE id = $1`,
        [approvalId, String(req.user?.userId || '')]
      );
      await req.orgDb.query(
        `UPDATE agent_actions
         SET status = 'failed', result = $2::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [approvalId, JSON.stringify({ error: detail })]
      );
      emitToProject(projectId, 'agent:approval', {
        id: approvalId,
        projectId,
        status: 'failed',
        actionType,
        result: { error: detail },
      });
      return jsonError(res, 500, 'Server error', detail);
    }

    await req.orgDb.query(
      `UPDATE agent_actions
       SET status = 'executed', result = $2::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [approvalId, JSON.stringify(result || {})]
    );

    emitToProject(projectId, 'agent:approval', {
      id: approvalId,
      projectId,
      status: 'approved',
      actionType,
      result,
    });
    emitToProject(projectId, 'agent:action', {
      id: approvalId,
      projectId,
      actionName: actionType,
      status: 'executed',
      result,
    });

    return res.status(200).json({ success: true, result });
  } catch (err) {
    return next(err);
  }
});

router.patch('/approvals/:id/reject', async (req, res, next) => {
  try {
    const approvalId = safe(req.params.id);
    if (!approvalId) return jsonError(res, 400, 'Bad request', 'approval id is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    await ensureAgentApprovalsTable(req.orgDb);
    await ensureAgentActionsTable(req.orgDb);

    const reason = safe(req.body?.reason) || 'Rejected by reviewer';

    const rowResp = await req.orgDb.query(
      `SELECT id, project_id, action_type, status
       FROM agent_approvals
       WHERE id = $1
       LIMIT 1`,
      [approvalId]
    );
    const approval = rowResp.rows[0];
    if (!approval) return jsonError(res, 404, 'Not found', 'Approval request not found.');
    if (safe(approval.status) !== 'pending') return jsonError(res, 409, 'Conflict', 'Approval has already been decided.');

    const projectId = safe(approval.project_id);
    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const rejectedBy = String(req.user?.userId || '');
    await req.orgDb.query(
      `UPDATE agent_approvals
       SET status = 'rejected', decided_by = $2, decided_at = NOW()
       WHERE id = $1`,
      [approvalId, rejectedBy]
    );
    await req.orgDb.query(
      `UPDATE agent_actions
       SET status = 'rejected', result = $2::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [approvalId, JSON.stringify({ rejectedBy, rejectedAt: new Date().toISOString(), reason })]
    );

    emitToProject(projectId, 'agent:approval', {
      id: approvalId,
      projectId,
      status: 'rejected',
      actionType: safe(approval.action_type),
      result: { rejectedBy, reason },
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
