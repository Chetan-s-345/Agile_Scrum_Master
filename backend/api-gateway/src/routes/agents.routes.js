const express = require('express');
const { randomUUID } = require('node:crypto');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const { getAgentsRuntime } = require('../../server/agents');
const {
  ensureAgentActionsTable,
  ensureAgentApprovalsTable,
  ensureAgentConfigsTable,
  ensureAgentDecisionsTable,
  executeCoreAction,
} = require('../../server/lib/agentActions');
const { emitToProject } = require('../realtime/io');

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

function normalizeAgentId(value) {
  return safe(value).toLowerCase().replace(/\s+/g, '-');
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

  return AGENT_CATALOG.filter((item) => allowedIds.has(item.id)).map((item) => {
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
    };
  });
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

router.get('/', async (req, res, next) => {
  try {
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');
    const projectId = safe(req.query.projectId);
    const runtime = getAgentsRuntime();
    const agents = await buildRoster(req.orgDb, runtime, projectId || null);
    return res.status(200).json({ agents });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:agentId/status', async (req, res, next) => {
  try {
    const agentId = normalizeAgentId(req.params.agentId);
    const nextStatus = safe(req.body?.status).toLowerCase();
    const projectId = safe(req.body?.projectId || req.query.projectId);
    if (!AGENT_CATALOG.some((item) => item.id === agentId)) return jsonError(res, 400, 'Bad request', 'Invalid agent id.');
    if (nextStatus !== 'active' && nextStatus !== 'paused') return jsonError(res, 400, 'Bad request', 'status must be active or paused.');
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

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
    if (runtime && runtimeName && typeof runtime.setAgentPaused === 'function') {
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

router.get('/:agentId/config', async (req, res, next) => {
  try {
    const agentId = normalizeAgentId(req.params.agentId);
    const projectId = safe(req.query.projectId);
    if (!AGENT_CATALOG.some((item) => item.id === agentId)) return jsonError(res, 400, 'Bad request', 'Invalid agent id.');
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

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

    return res.status(200).json({ config });
  } catch (err) {
    return next(err);
  }
});

router.patch('/:agentId/config', async (req, res, next) => {
  try {
    const agentId = normalizeAgentId(req.params.agentId);
    const projectId = safe(req.body?.projectId || req.query.projectId);
    if (!AGENT_CATALOG.some((item) => item.id === agentId)) return jsonError(res, 400, 'Bad request', 'Invalid agent id.');
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

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
    if (!AGENT_CATALOG.some((item) => item.id === agentId)) return jsonError(res, 400, 'Bad request', 'Invalid agent id.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

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

    return res.status(200).json({ items: resp.rows, page, pageSize });
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
           WHERE project_id = $1 AND LOWER(COALESCE(source, '')) = $2
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
