const express = require('express');
const { randomUUID } = require('node:crypto');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const { executeCoreAction, ensureAgentDecisionsTable } = require('../../server/lib/agentActions');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

function safe(value) {
  return String(value || '').trim();
}

function jsonError(res, status, error, detail) {
  return res.status(status).json({ error, code: status, detail });
}

function sendSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function startSse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

async function ensureSprintAutopilotTable(orgPool) {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS sprint_autopilot_proposals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sprint_length INTEGER NOT NULL DEFAULT 14,
      focus_area TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      proposal JSONB NOT NULL,
      reasoning JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by TEXT,
      approved_sprint_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
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
      'sprint-autopilot',
      String(payload.projectId),
      String(payload.actionDescription),
      JSON.stringify(payload.reasoning || {}),
      Number(payload.confidence || 80),
      JSON.stringify(payload.dataUsed || {}),
      String(payload.status || 'executed'),
      safe(payload.resolvedBy) || null,
      String(payload.resolutionType || 'auto-executed'),
    ]
  );
}

async function readVelocity(orgPool, projectId) {
  const resp = await orgPool.query(
    `SELECT name, planned_points, completed_points
     FROM sprints
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT 6`,
    [String(projectId)]
  );

  const rows = resp.rows || [];
  const avg = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + toNum(row.completed_points, 0), 0) / rows.length)
    : 20;

  return { rows, average: Math.max(8, avg || 0) };
}

async function readGithubOpenIssues(orgPool, projectId) {
  const reg = await orgPool.query("SELECT to_regclass('github_issues') AS name");
  if (!reg.rows[0]?.name) return 0;
  const resp = await orgPool.query(
    `SELECT COUNT(*)::int AS count
     FROM github_issues
     WHERE project_id = $1
       AND LOWER(COALESCE(state, 'open')) = 'open'`,
    [String(projectId)]
  );
  return toNum(resp.rows[0]?.count, 0);
}

async function readDependencies(orgPool, projectId) {
  const reg = await orgPool.query("SELECT to_regclass('task_dependencies') AS name");
  if (!reg.rows[0]?.name) return 0;
  const resp = await orgPool.query(
    `SELECT COUNT(*)::int AS count
     FROM task_dependencies td
     JOIN tasks t ON t.id = td.task_id
     WHERE t.project_id = $1`,
    [String(projectId)]
  );
  return toNum(resp.rows[0]?.count, 0);
}

function priorityScore(priority) {
  const v = safe(priority).toLowerCase();
  if (v === 'critical') return 0;
  if (v === 'high') return 1;
  if (v === 'medium') return 2;
  if (v === 'low') return 3;
  return 4;
}

function formatDateOnly(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function pickAssignee(task, developers, loadByDev) {
  const existing = safe(task.assignee_id);
  if (existing && loadByDev.has(existing)) return existing;

  const tags = Array.isArray(task.tech_tags) ? task.tech_tags.map((x) => safe(x).toLowerCase()) : [];
  const ranked = developers
    .map((dev) => {
      const id = safe(dev.id);
      const skills = Object.keys(dev.skill_levels || {}).map((k) => String(k).toLowerCase());
      const skillMatch = tags.some((tag) => skills.includes(tag)) ? 1 : 0;
      const projected = toNum(loadByDev.get(id), 0);
      return { id, skillMatch, projected };
    })
    .sort((a, b) => b.skillMatch - a.skillMatch || a.projected - b.projected);

  return ranked[0]?.id || '';
}

function taskReason(task, assigneeName, focusArea) {
  const due = task.due_date ? `Due ${formatDateOnly(task.due_date)}` : 'No hard due date';
  const focusText = focusArea ? `aligned to ${focusArea}` : 'aligned to sprint priorities';
  return `${safe(task.priority || 'medium').toUpperCase()} priority, ${focusText}. ${due}. Assigned to ${assigneeName || 'best-fit developer'} based on capacity.`;
}

async function buildProposal(orgPool, projectId, sprintLength, focusArea) {
  const [backlogResp, devResp, velocity, githubOpenIssues, dependencyCount] = await Promise.all([
    orgPool.query(
      `SELECT t.id, t.title, t.story_points, t.priority, t.assignee_id, t.due_date, t.tech_tags
       FROM tasks t
       WHERE t.project_id = $1
         AND t.status NOT IN ('done', 'cancelled')
         AND t.sprint_id IS NULL
       ORDER BY
         CASE LOWER(COALESCE(t.priority, 'medium'))
           WHEN 'critical' THEN 0
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 3
           ELSE 4
         END,
         t.due_date ASC NULLS LAST,
         t.created_at ASC
       LIMIT 80`,
      [String(projectId)]
    ),
    orgPool.query(
      `SELECT dp.id, COALESCE(tm.full_name, tm.email) AS full_name,
              dp.current_sprint_load, dp.max_sprint_capacity, dp.skill_levels
       FROM developer_profiles dp
       JOIN team_members tm ON tm.id = dp.member_id
       WHERE tm.is_active = TRUE
       ORDER BY tm.full_name ASC`
    ),
    readVelocity(orgPool, projectId),
    readGithubOpenIssues(orgPool, projectId),
    readDependencies(orgPool, projectId),
  ]);

  const developers = devResp.rows || [];
  const backlog = (backlogResp.rows || []).sort((a, b) => {
    const pa = priorityScore(a.priority);
    const pb = priorityScore(b.priority);
    if (pa !== pb) return pa - pb;
    if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return 0;
  });

  const capacityTotal = developers.reduce((sum, row) => sum + Math.max(0, toNum(row.max_sprint_capacity, 0)), 0);
  const currentLoad = developers.reduce((sum, row) => sum + Math.max(0, toNum(row.current_sprint_load, 0)), 0);
  const availableCapacity = Math.max(6, capacityTotal - currentLoad);
  const budget = Math.max(8, Math.min(availableCapacity, velocity.average));

  const loadByDev = new Map(developers.map((row) => [safe(row.id), toNum(row.current_sprint_load, 0)]));
  const developerById = new Map(developers.map((row) => [safe(row.id), safe(row.full_name)]));

  const selected = [];
  let selectedPoints = 0;
  for (const task of backlog) {
    if (selected.length >= 24) break;
    const points = Math.max(1, toNum(task.story_points, 1));
    if (selected.length > 0 && selectedPoints + points > budget + 3) continue;

    const assigneeId = pickAssignee(task, developers, loadByDev);
    const assigneeName = developerById.get(assigneeId) || 'Unassigned';
    loadByDev.set(assigneeId, toNum(loadByDev.get(assigneeId), 0) + points);

    selected.push({
      taskId: String(task.id),
      title: safe(task.title),
      assigneeId,
      assigneeName,
      storyPoints: points,
      priority: safe(task.priority || 'medium').toLowerCase(),
      reason: taskReason(task, assigneeName, focusArea),
    });

    selectedPoints += points;
  }

  const capacity = developers.map((dev) => {
    const id = safe(dev.id);
    const max = Math.max(1, toNum(dev.max_sprint_capacity, 1));
    const proposed = Math.max(0, toNum(loadByDev.get(id), 0));
    return {
      developerId: id,
      developerName: safe(dev.full_name),
      proposedPoints: proposed,
      proposedLoadPct: Math.round((proposed / max) * 100),
    };
  });

  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + Math.max(5, sprintLength - 1));

  const risks = [];
  if (capacity.some((row) => row.proposedLoadPct > 95)) risks.push('One or more developers exceed 95% projected capacity.');
  if (dependencyCount > 0) risks.push(`Detected ${dependencyCount} task dependencies that can block flow.`);
  if (githubOpenIssues > 15) risks.push(`GitHub has ${githubOpenIssues} open issues; triage spillover risk is elevated.`);
  if (!risks.length) risks.push('No critical risk identified from current signals.');

  const proposal = {
    sprintName: `Sprint ${formatDateOnly(start)}`,
    goal: focusArea
      ? `Deliver highest-impact ${focusArea} outcomes while preserving team sustainability.`
      : 'Deliver highest-priority backlog scope while keeping team load balanced.',
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
    tasks: selected,
    capacity,
    risks,
    inputs: {
      budget,
      selectedPoints,
      availableCapacity,
      averageVelocity: velocity.average,
      githubOpenIssues,
      dependencyCount,
      sprintLength,
      focusArea: safe(focusArea) || null,
    },
  };

  const reasoning = [
    `Scanned ${backlog.length} backlog items and prioritized by urgency and due dates.`,
    `Calculated team available capacity at ${availableCapacity} points and velocity baseline at ${velocity.average} points.`,
    `Selected ${selected.length} tasks totaling ${selectedPoints} points with load-aware assignee suggestions.`,
    `Risk analysis includes dependencies (${dependencyCount}) and GitHub open issues (${githubOpenIssues}).`,
  ];

  return { proposal, reasoning };
}

router.post('/generate', async (req, res, next) => {
  try {
    const projectId = safe(req.body?.projectId);
    const sprintLength = Math.max(5, Math.min(30, toNum(req.body?.sprintLength, 14)));
    const focusArea = safe(req.body?.focusArea);
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    startSse(res);
    sendSse(res, { type: 'reasoning', message: 'Analyzing backlog items and sprint constraints...' });

    const { proposal, reasoning } = await buildProposal(req.orgDb, projectId, sprintLength, focusArea);
    await ensureSprintAutopilotTable(req.orgDb);

    const proposalId = randomUUID();
    await req.orgDb.query(
      `INSERT INTO sprint_autopilot_proposals (
         id, project_id, sprint_length, focus_area, status, proposal, reasoning, created_by
       ) VALUES ($1,$2,$3,$4,'generated',$5::jsonb,$6::jsonb,$7)`,
      [proposalId, projectId, sprintLength, focusArea || null, JSON.stringify(proposal), JSON.stringify(reasoning), safe(req.user?.userId) || null]
    );

    for (const line of reasoning) sendSse(res, { type: 'reasoning', message: line });
    sendSse(res, { type: 'proposal', proposalId, proposal });
    sendSse(res, { type: 'done' });
    res.end();
  } catch (err) {
    return next(err);
  }
});

router.post('/draft', async (req, res, next) => {
  try {
    const proposalId = safe(req.body?.proposalId);
    const projectId = safe(req.body?.projectId);
    const proposal = req.body?.proposal && typeof req.body.proposal === 'object' ? req.body.proposal : null;
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    await ensureSprintAutopilotTable(req.orgDb);

    if (proposalId) {
      await req.orgDb.query(
        `UPDATE sprint_autopilot_proposals
         SET status = 'draft',
             proposal = COALESCE($2::jsonb, proposal),
             updated_at = NOW()
         WHERE id = $1`,
        [proposalId, proposal ? JSON.stringify(proposal) : null]
      );
      return res.status(200).json({ success: true, proposalId });
    }

    if (!projectId || !proposal) return jsonError(res, 400, 'Bad request', 'projectId and proposal are required.');
    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const id = randomUUID();
    await req.orgDb.query(
      `INSERT INTO sprint_autopilot_proposals (
         id, project_id, sprint_length, focus_area, status, proposal, reasoning, created_by
       ) VALUES ($1,$2,$3,$4,'draft',$5::jsonb,'[]'::jsonb,$6)`,
      [id, projectId, Math.max(5, Math.min(30, toNum(req.body?.sprintLength, 14))), safe(req.body?.focusArea) || null, JSON.stringify(proposal), safe(req.user?.userId) || null]
    );

    return res.status(200).json({ success: true, proposalId: id });
  } catch (err) {
    return next(err);
  }
});

router.post('/approve', async (req, res, next) => {
  try {
    const proposalId = safe(req.body?.proposalId);
    const modifications = req.body?.modifications && typeof req.body.modifications === 'object' ? req.body.modifications : {};
    if (!proposalId) return jsonError(res, 400, 'Bad request', 'proposalId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    await ensureSprintAutopilotTable(req.orgDb);
    const rowResp = await req.orgDb.query(
      `SELECT id, project_id, proposal
       FROM sprint_autopilot_proposals
       WHERE id = $1
       LIMIT 1`,
      [proposalId]
    );
    const row = rowResp.rows[0];
    if (!row) return jsonError(res, 404, 'Not found', 'Proposal not found.');

    const access = await ensureProjectAccess(req.orgDb, row.project_id, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const proposal = {
      ...(row.proposal || {}),
      ...(modifications || {}),
      tasks: Array.isArray(modifications?.tasks) ? modifications.tasks : Array.isArray(row.proposal?.tasks) ? row.proposal.tasks : [],
    };

    const sprintResp = await executeCoreAction(req.orgDb, {
      projectId: String(row.project_id),
      userId: String(req.user?.userId || ''),
      executionMode: 'auto',
    }, 'create_sprint', {
      name: safe(proposal.sprintName) || `Sprint ${formatDateOnly(new Date())}`,
      goal: safe(proposal.goal) || null,
      startDate: safe(proposal.startDate),
      endDate: safe(proposal.endDate),
    });

    const sprintId = safe(sprintResp?.sprintId);
    if (!sprintId) return jsonError(res, 500, 'Server error', 'Failed to create sprint from proposal.');

    for (const task of proposal.tasks.slice(0, 60)) {
      const taskId = safe(task.taskId);
      const assigneeId = safe(task.assigneeId);
      if (!taskId) continue;

      await executeCoreAction(req.orgDb, {
        projectId: String(row.project_id),
        userId: String(req.user?.userId || ''),
        executionMode: 'auto',
      }, 'move_tasks_to_sprint', {
        sprintId,
        taskIds: [taskId],
      });

      if (assigneeId) {
        await executeCoreAction(req.orgDb, {
          projectId: String(row.project_id),
          userId: String(req.user?.userId || ''),
          executionMode: 'auto',
        }, 'assign_task', {
          taskId,
          developerId: assigneeId,
        });
      }
    }

    await req.orgDb.query(
      `UPDATE sprint_autopilot_proposals
       SET status = 'approved', proposal = $2::jsonb, approved_sprint_id = $3, updated_at = NOW()
       WHERE id = $1`,
      [proposalId, JSON.stringify(proposal), sprintId]
    );

    await insertAgentDecision(req.orgDb, {
      projectId: row.project_id,
      actionDescription: 'Sprint proposal approved and converted into active sprint.',
      reasoning: { proposalId, modificationsApplied: Object.keys(modifications || {}) },
      dataUsed: { sprintId, proposal },
      status: 'executed',
      resolvedBy: String(req.user?.userId || ''),
      resolutionType: 'approved',
    });

    return res.status(200).json({ success: true, sprintId, proposalId });
  } catch (err) {
    return next(err);
  }
});

router.get('/proposals', async (req, res, next) => {
  try {
    const projectId = safe(req.query.projectId);
    const status = safe(req.query.status).toLowerCase();
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    await ensureSprintAutopilotTable(req.orgDb);
    const resp = await req.orgDb.query(
      `SELECT id, project_id, sprint_length, focus_area, status, proposal, reasoning, approved_sprint_id, created_at, updated_at
       FROM sprint_autopilot_proposals
       WHERE project_id = $1
         AND ($2::text = '' OR LOWER(status) = $2)
       ORDER BY created_at DESC
       LIMIT 40`,
      [projectId, status]
    );

    return res.status(200).json({ items: resp.rows || [] });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
