const axios = require('axios');
const { randomUUID } = require('node:crypto');

const { db } = require('../../src/config/database');
const { logger } = require('../../src/middleware/logger');
const { executeActionWithPolicy } = require('../lib/agentActions');

const AGENTS = {
  STALE_TASK_DETECTOR: 'stale-task-detector',
  SPRINT_RISK_MONITOR: 'sprint-risk-monitor',
  UNASSIGNED_TASK_ALERT: 'unassigned-task-alert',
  DAILY_STANDUP_COMPILER: 'daily-standup-compiler',
  SPRINT_COMPLETION_REPORTER: 'sprint-completion-reporter',
};

const SCHEDULES = {
  [AGENTS.STALE_TASK_DETECTOR]: { hourUtc: 9, minuteUtc: 0 },
  [AGENTS.SPRINT_RISK_MONITOR]: { hourUtc: 8, minuteUtc: 0 },
  [AGENTS.UNASSIGNED_TASK_ALERT]: { hourUtc: 10, minuteUtc: 0 },
  [AGENTS.DAILY_STANDUP_COMPILER]: { hourUtc: 9, minuteUtc: 30 },
};

function safe(value) {
  return String(value || '').trim();
}

function pct(num, den) {
  if (!den) return 0;
  return Math.round((Number(num || 0) / Number(den || 0)) * 10000) / 100;
}

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function scheduleKey(agentName, date) {
  return `${agentName}:${date.toISOString().slice(0, 10)}`;
}

function nextRunIso({ hourUtc, minuteUtc }) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(Number(hourUtc), Number(minuteUtc), 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

async function ensureAgentTables(orgPool) {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS agent_runs (
      agent_name TEXT PRIMARY KEY,
      last_run TIMESTAMPTZ,
      last_status TEXT,
      last_result JSONB
    )`
  );

  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS standups (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      developer_id TEXT,
      date DATE,
      yesterday TEXT,
      today TEXT,
      blockers TEXT,
      generated BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );

  await orgPool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS "isStale" BOOLEAN DEFAULT FALSE');
  await orgPool.query('ALTER TABLE sprints ADD COLUMN IF NOT EXISTS "riskLevel" TEXT');
}

async function upsertAgentRun(orgPool, agentName, status, result) {
  await ensureAgentTables(orgPool);
  await orgPool.query(
    `INSERT INTO agent_runs (agent_name, last_run, last_status, last_result)
     VALUES ($1, NOW(), $2, $3::jsonb)
     ON CONFLICT (agent_name) DO UPDATE
     SET last_run = EXCLUDED.last_run,
         last_status = EXCLUDED.last_status,
         last_result = EXCLUDED.last_result`,
    [String(agentName), String(status), JSON.stringify(result || {})]
  );
}

async function logAgentAction(orgPool, projectId, userId, actionName, input, result, status) {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS agent_actions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      user_id TEXT,
      action_name TEXT,
      input JSONB,
      result JSONB,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );

  await orgPool.query(
    `INSERT INTO agent_actions (id, project_id, user_id, action_name, input, result, status)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [
      randomUUID(),
      projectId ? String(projectId) : null,
      userId ? String(userId) : null,
      String(actionName),
      JSON.stringify(input || {}),
      JSON.stringify(result || {}),
      String(status || 'executed'),
    ]
  );
}

async function listOrgIdsWithTenantDb() {
  const hasColumn = await db._orgHasColumn('db_connection_string');
  if (!hasColumn) return [];
  const resp = await db.universalPool.query(
    `SELECT id
     FROM organizations
     WHERE db_connection_string IS NOT NULL
       AND LENGTH(TRIM(db_connection_string)) > 0`
  );
  return resp.rows.map((r) => String(r.id));
}

async function getScrumMemberIds(orgPool, projectId) {
  const resp = await orgPool.query(
    `SELECT DISTINCT member_id
     FROM project_members
     WHERE project_id = $1
       AND role IN ('owner','admin','manager')`,
    [String(projectId)]
  );
  return resp.rows.map((r) => String(r.member_id));
}

async function notifyMembers(orgPool, memberIds, payload) {
  const uniq = [...new Set((Array.isArray(memberIds) ? memberIds : []).filter(Boolean).map((id) => String(id)))];
  for (const memberId of uniq) {
    await orgPool.query(
      `INSERT INTO notifications (recipient_member_id, type, title, body, action_url, reference_id, reference_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        String(memberId),
        String(payload.type || 'in_app_notice'),
        String(payload.title || 'Agent notification'),
        safe(payload.body) || null,
        safe(payload.actionUrl) || null,
        safe(payload.referenceId) || null,
        safe(payload.referenceType) || null,
      ]
    );
  }
  return uniq;
}

async function runStaleTaskDetectorForOrg(orgPool, orgId) {
  await ensureAgentTables(orgPool);

  const staleInProgress = await orgPool.query(
    `SELECT id, title, project_id, assignee_id, jira_issue_key,
            COALESCE(updated_at, created_at) AS last_touched,
            EXTRACT(DAY FROM (NOW() - COALESCE(updated_at, created_at)))::int AS stale_days
     FROM tasks
     WHERE status = 'in_progress'
       AND COALESCE(updated_at, created_at) <= NOW() - INTERVAL '3 days'`
  );

  const staleTodo = await orgPool.query(
    `SELECT t.id, t.title, t.project_id, t.assignee_id, t.jira_issue_key,
            s.start_date,
            EXTRACT(DAY FROM (CURRENT_DATE - s.start_date))::int AS sprint_day
     FROM tasks t
     JOIN sprints s ON s.id = t.sprint_id
     WHERE s.status = 'active'
       AND t.status = 'todo'
       AND CURRENT_DATE >= s.start_date + INTERVAL '3 days'`
  );

  const allRows = [...staleInProgress.rows, ...staleTodo.rows];
  let notified = 0;

  for (const row of allRows) {
    const scrumIds = await getScrumMemberIds(orgPool, row.project_id);

    const assigneeResp = await orgPool.query(
      `SELECT tm.id AS member_id
       FROM developer_profiles dp
       JOIN team_members tm ON tm.id = dp.member_id
       WHERE dp.id = $1
       LIMIT 1`,
      [row.assignee_id || null]
    );

    const memberIds = [...scrumIds, assigneeResp.rows[0]?.member_id].filter(Boolean);
    const taskCode = safe(row.jira_issue_key) || `TASK-${String(row.id).slice(0, 8)}`;

    const notifiedUsers = await notifyMembers(orgPool, memberIds, {
      type: 'delay_alert',
      title: `Stale task detected: ${taskCode}`,
      body: `Task ${taskCode} has become stale and needs attention.`,
      actionUrl: `/tasks/${row.id}`,
      referenceId: String(row.id),
      referenceType: 'task',
    });

    notified += notifiedUsers.length;

    const staleDays = Number(row.stale_days || 0);
    if (staleDays > 5) {
      await orgPool.query('UPDATE tasks SET "isStale" = TRUE, updated_at = NOW() WHERE id = $1', [String(row.id)]);
    }

    await logAgentAction(
      orgPool,
      row.project_id,
      `system:${orgId}`,
      'stale_task_detected',
      { taskId: row.id, staleDays },
      { notifiedUsers, taskCode },
      'executed'
    );
  }

  return { staleCount: allRows.length, notificationsSent: notified };
}

async function runSprintRiskMonitorForOrg(orgPool, orgId) {
  await ensureAgentTables(orgPool);
  const sprintsResp = await orgPool.query(
    `SELECT id, name, project_id, start_date, end_date
     FROM sprints
     WHERE status = 'active'`
  );

  const flagged = [];

  for (const sprint of sprintsResp.rows) {
    const totalDays = Math.max(1, Math.floor((new Date(`${isoDate(sprint.end_date)}T00:00:00Z`) - new Date(`${isoDate(sprint.start_date)}T00:00:00Z`)) / 86400000) + 1);
    const elapsed = Math.max(1, Math.floor((new Date() - new Date(`${isoDate(sprint.start_date)}T00:00:00Z`)) / 86400000) + 1);
    const timeConsumed = Math.min(100, pct(elapsed, totalDays));

    const tasksResp = await orgPool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'done')::int AS done
       FROM tasks
       WHERE sprint_id = $1`,
      [String(sprint.id)]
    );

    const totalTasks = Number(tasksResp.rows[0]?.total || 0);
    const doneTasks = Number(tasksResp.rows[0]?.done || 0);
    const workDone = pct(doneTasks, totalTasks || 1);

    let riskLevel = 'ON_TRACK';
    if (timeConsumed > workDone + 40) riskLevel = 'CRITICAL';
    else if (timeConsumed > workDone + 20) riskLevel = 'AT_RISK';

    await orgPool.query('UPDATE sprints SET "riskLevel" = $2, updated_at = NOW() WHERE id = $1', [String(sprint.id), riskLevel]);

    if (riskLevel !== 'ON_TRACK') {
      const scrumIds = await getScrumMemberIds(orgPool, sprint.project_id);
      const message = `Sprint ${sprint.name} is ${riskLevel}: ${workDone}% done with ${timeConsumed}% time elapsed`;
      const notifiedUsers = await notifyMembers(orgPool, scrumIds, {
        type: 'delay_alert',
        title: `Sprint ${riskLevel}: ${sprint.name}`,
        body: message,
        actionUrl: `/sprints/${sprint.id}`,
        referenceId: String(sprint.id),
        referenceType: 'sprint',
      });

      flagged.push({ sprintId: sprint.id, riskLevel, workDone, timeConsumed, notified: notifiedUsers.length });

      await logAgentAction(
        orgPool,
        sprint.project_id,
        `system:${orgId}`,
        'sprint_risk_monitor',
        { sprintId: sprint.id },
        { riskLevel, workDone, timeConsumed, notifiedUsers },
        'executed'
      );
    }
  }

  return { activeSprints: sprintsResp.rows.length, flagged };
}

async function runUnassignedTaskAlertForOrg(orgPool, orgId) {
  await ensureAgentTables(orgPool);
  const resp = await orgPool.query(
    `SELECT t.id, t.title, t.project_id, t.jira_issue_key
     FROM tasks t
     JOIN sprints s ON s.id = t.sprint_id
     WHERE s.status = 'active'
       AND t.assignee_id IS NULL
       AND COALESCE(t.updated_at, t.created_at) <= NOW() - INTERVAL '2 days'`
  );

  let sent = 0;

  for (const task of resp.rows) {
    const suggestions = await executeActionWithPolicy(
      orgPool,
      {
        projectId: String(task.project_id),
        userId: `system:${orgId}`,
        executionMode: 'auto',
      },
      'suggest_assignments',
      { taskIds: [String(task.id)] }
    );

    const first = Array.isArray(suggestions) ? suggestions[0] : null;
    const rec = first?.recommended || null;
    const scrumIds = await getScrumMemberIds(orgPool, task.project_id);
    const taskCode = safe(task.jira_issue_key) || `TASK-${String(task.id).slice(0, 8)}`;
    const text = rec
      ? `Task ${taskCode} has no assignee. Suggested: ${rec.name} (${rec.reason})`
      : `Task ${taskCode} has no assignee and no strong suggestion is currently available.`;

    const notifiedUsers = await notifyMembers(orgPool, scrumIds, {
      type: 'task_assigned',
      title: `Unassigned task alert: ${taskCode}`,
      body: text,
      actionUrl: `/tasks/${task.id}`,
      referenceId: String(task.id),
      referenceType: 'task',
    });

    sent += notifiedUsers.length;

    await logAgentAction(
      orgPool,
      task.project_id,
      `system:${orgId}`,
      'unassigned_task_alert',
      { taskId: task.id },
      { suggestion: rec, notifiedUsers },
      'executed'
    );
  }

  return { unassigned: resp.rows.length, notificationsSent: sent };
}

function splitStandupSections(text) {
  const raw = safe(text);
  const y = raw.match(/yesterday\s*:\s*([\s\S]*?)(?:\n\s*today\s*:|$)/i);
  const t = raw.match(/today\s*:\s*([\s\S]*?)(?:\n\s*blockers\s*:|$)/i);
  const b = raw.match(/blockers\s*:\s*([\s\S]*)$/i);
  return {
    yesterday: safe(y?.[1]) || raw,
    today: safe(t?.[1]) || raw,
    blockers: safe(b?.[1]) || 'None',
  };
}

async function callAnthropicStandup(message) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!safe(key)) return 'Standup generation skipped: ANTHROPIC_API_KEY missing.';

  const resp = await axios({
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    timeout: 120000,
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    data: {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: 'You are a scrum assistant. Produce concise standup using sections Yesterday:, Today:, Blockers:.',
      messages: [{ role: 'user', content: String(message) }],
    },
    validateStatus: () => true,
  });

  if (resp.status >= 400) {
    return 'Standup generation failed. Falling back to raw context summary.';
  }

  const blocks = Array.isArray(resp.data?.content) ? resp.data.content : [];
  const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('');
  return safe(text) || 'No standup text generated.';
}

async function runDailyStandupCompilerForOrg(orgPool, orgId) {
  await ensureAgentTables(orgPool);
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yIso = yesterday.toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);

  const projectsResp = await orgPool.query(
    `SELECT DISTINCT p.id
     FROM projects p
     JOIN sprints s ON s.project_id = p.id
     WHERE s.status = 'active'`
  );

  let created = 0;

  for (const project of projectsResp.rows) {
    const devResp = await orgPool.query(
      `SELECT dp.id AS developer_id
       FROM project_members pm
       JOIN developer_profiles dp ON dp.member_id = pm.member_id
       WHERE pm.project_id = $1`,
      [String(project.id)]
    );

    for (const dev of devResp.rows) {
      const yTasksResp = await orgPool.query(
        `SELECT title, status
         FROM tasks
         WHERE project_id = $1
           AND assignee_id = $2
           AND updated_at::date = $3::date
         ORDER BY updated_at DESC
         LIMIT 25`,
        [String(project.id), String(dev.developer_id), yIso]
      );

      const todayTasksResp = await orgPool.query(
        `SELECT title, status
         FROM tasks
         WHERE project_id = $1
           AND assignee_id = $2
           AND status IN ('todo','in_progress')
         ORDER BY updated_at DESC
         LIMIT 25`,
        [String(project.id), String(dev.developer_id)]
      );

      const blockedResp = await orgPool.query(
        `SELECT title
         FROM tasks
         WHERE project_id = $1
           AND assignee_id = $2
           AND status = 'blocked'
         ORDER BY updated_at DESC
         LIMIT 25`,
        [String(project.id), String(dev.developer_id)]
      );

      const context = [
        `Developer: ${dev.developer_id}`,
        `Yesterday tasks: ${(yTasksResp.rows || []).map((r) => `${r.title} (${r.status})`).join('; ') || 'None'}`,
        `Today tasks: ${(todayTasksResp.rows || []).map((r) => `${r.title} (${r.status})`).join('; ') || 'None'}`,
        `Blocked tasks: ${(blockedResp.rows || []).map((r) => r.title).join('; ') || 'None'}`,
      ].join('\n');

      const generated = await callAnthropicStandup(context);
      const sections = splitStandupSections(generated);

      await orgPool.query(
        `INSERT INTO standups (id, project_id, developer_id, date, yesterday, today, blockers, generated)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,TRUE)`,
        [
          randomUUID(),
          String(project.id),
          String(dev.developer_id),
          todayIso,
          sections.yesterday,
          sections.today,
          sections.blockers,
        ]
      );

      created += 1;

      await logAgentAction(
        orgPool,
        project.id,
        `system:${orgId}`,
        'daily_standup_compiled',
        { developerId: dev.developer_id, date: todayIso },
        { generated: true },
        'executed'
      );
    }
  }

  return { standupsCreated: created };
}

async function callAnthropicReport(message) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!safe(key)) return 'Report generation skipped: ANTHROPIC_API_KEY missing.';

  const resp = await axios({
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    timeout: 120000,
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    data: {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: 'Generate a concise sprint completion report with achievements, challenges, and recommendations.',
      messages: [{ role: 'user', content: String(message) }],
    },
    validateStatus: () => true,
  });

  if (resp.status >= 400) return 'Sprint report generation failed.';

  const blocks = Array.isArray(resp.data?.content) ? resp.data.content : [];
  return safe(blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('')) || 'No report text generated.';
}

async function runSprintCompletionReporterForOrg(orgPool, orgId) {
  await ensureAgentTables(orgPool);

  const resp = await orgPool.query(
    `SELECT s.id, s.name, s.project_id, s.planned_points, s.completed_points
     FROM sprints s
     LEFT JOIN sprint_reports sr ON sr.sprint_id = s.id
     WHERE s.status = 'completed'
       AND sr.sprint_id IS NULL`
  );

  let reports = 0;

  for (const sprint of resp.rows) {
    const metricsResp = await orgPool.query(
      `SELECT
         COUNT(*)::int AS total_tasks,
         COUNT(*) FILTER (WHERE status = 'done')::int AS done_tasks,
         COUNT(*) FILTER (WHERE status <> 'done')::int AS carried_over,
         ROUND(AVG(CASE WHEN started_at IS NOT NULL AND completed_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (completed_at - started_at))/3600 ELSE NULL END)::numeric, 2) AS avg_cycle_hours
       FROM tasks
       WHERE sprint_id = $1`,
      [String(sprint.id)]
    );

    const m = metricsResp.rows[0] || {};
    const completionRate = pct(Number(sprint.completed_points || 0), Number(sprint.planned_points || 0) || 1);
    const plannedPoints = Number(sprint.planned_points || 0);
    const deliveredPoints = Number(sprint.completed_points || 0);
    const carriedOverTasks = Number(m.carried_over || 0);
    const averageCycleTime = Number(m.avg_cycle_hours || 0);

    const prompt = [
      `Sprint: ${sprint.name}`,
      `completionRate: ${completionRate}`,
      `plannedPoints: ${plannedPoints}`,
      `deliveredPoints: ${deliveredPoints}`,
      `carriedOverTasks: ${carriedOverTasks}`,
      `averageCycleTimeHours: ${averageCycleTime}`,
    ].join('\n');

    const reportText = await callAnthropicReport(prompt);

    await orgPool.query(
      `INSERT INTO sprint_reports (
         sprint_id,
         generated_by,
         total_story_points,
         completed_story_points,
         completion_rate,
         velocity,
         executive_summary,
         recommendations
       ) VALUES ($1,'ai',$2,$3,$4,$5,$6,$7)`,
      [
        String(sprint.id),
        plannedPoints,
        deliveredPoints,
        completionRate,
        deliveredPoints,
        reportText,
        'Review carried-over items and rebalance next sprint scope.',
      ]
    );

    const teamResp = await orgPool.query('SELECT member_id FROM project_members WHERE project_id = $1', [String(sprint.project_id)]);
    await notifyMembers(orgPool, teamResp.rows.map((r) => r.member_id), {
      type: 'report_ready',
      title: `Sprint report ready: ${sprint.name}`,
      body: `Completion ${completionRate}%, delivered ${deliveredPoints}/${plannedPoints} points.`,
      actionUrl: `/reports`,
      referenceId: String(sprint.id),
      referenceType: 'sprint',
    });

    reports += 1;

    await logAgentAction(
      orgPool,
      sprint.project_id,
      `system:${orgId}`,
      'sprint_completion_report_generated',
      { sprintId: sprint.id },
      { completionRate, plannedPoints, deliveredPoints, carriedOverTasks, averageCycleTime },
      'executed'
    );
  }

  return { reportsGenerated: reports };
}

async function runForAllOrgs(runOrgFn) {
  const orgIds = await listOrgIdsWithTenantDb();
  const out = [];
  for (const orgId of orgIds) {
    try {
      const orgPool = await db.getOrgPool(String(orgId));
      const result = await runOrgFn(orgPool, orgId);
      out.push({ orgId: String(orgId), ok: true, result });
    } catch (err) {
      out.push({ orgId: String(orgId), ok: false, error: safe(err?.message) || 'Agent run failed' });
    }
  }
  return out;
}

async function runWithTracking(agentName, runner, state) {
  const startedAt = nowIso();
  state[agentName] = state[agentName] || {};
  state[agentName].status = 'running';

  try {
    const result = await runner();
    state[agentName].lastRun = startedAt;
    state[agentName].status = 'ok';
    return result;
  } catch (err) {
    state[agentName].lastRun = startedAt;
    state[agentName].status = 'failed';
    throw err;
  }
}

function createMonitors() {
  const state = {};
  const ticks = {};
  const timers = [];
  const pausedAgents = new Set();

  async function runAgent(agentName, runFn) {
    if (pausedAgents.has(agentName)) {
      state[agentName] = state[agentName] || { name: agentName, status: 'paused', lastRun: null, nextRun: nowIso() };
      state[agentName].status = 'paused';
      return [];
    }

    const runs = await runWithTracking(agentName, runFn, state);

    for (const item of runs) {
      if (!item.ok) continue;
      const orgPool = await db.getOrgPool(String(item.orgId));
      await upsertAgentRun(orgPool, agentName, 'ok', item.result);
    }

    for (const item of runs.filter((x) => !x.ok)) {
      try {
        const orgPool = await db.getOrgPool(String(item.orgId));
        await upsertAgentRun(orgPool, agentName, 'failed', { error: item.error });
      } catch {
        // ignore
      }
    }
  }

  function scheduleDaily(agentName, hourUtc, minuteUtc, runFn) {
    state[agentName] = { name: agentName, status: 'idle', lastRun: null, nextRun: nextRunIso({ hourUtc, minuteUtc }) };

    const timer = setInterval(async () => {
      const now = new Date();
      if (now.getUTCHours() !== Number(hourUtc) || now.getUTCMinutes() !== Number(minuteUtc)) return;

      const key = scheduleKey(agentName, now);
      if (ticks[key]) return;
      ticks[key] = true;

      try {
        await runAgent(agentName, runFn);
      } catch (err) {
        logger.error({ err, agentName }, 'agent.run.failed');
      } finally {
        state[agentName].nextRun = nextRunIso({ hourUtc, minuteUtc });
      }
    }, 60_000);

    timers.push(timer);
  }

  function start() {
    scheduleDaily(AGENTS.SPRINT_RISK_MONITOR, 8, 0, () => runForAllOrgs(runSprintRiskMonitorForOrg));
    scheduleDaily(AGENTS.STALE_TASK_DETECTOR, 9, 0, () => runForAllOrgs(runStaleTaskDetectorForOrg));
    scheduleDaily(AGENTS.DAILY_STANDUP_COMPILER, 9, 30, () => runForAllOrgs(runDailyStandupCompilerForOrg));
    scheduleDaily(AGENTS.UNASSIGNED_TASK_ALERT, 10, 0, () => runForAllOrgs(runUnassignedTaskAlertForOrg));

    const completionTimer = setInterval(async () => {
      const agentName = AGENTS.SPRINT_COMPLETION_REPORTER;
      state[agentName] = state[agentName] || { name: agentName, status: 'idle', lastRun: null, nextRun: nowIso() };
      try {
        await runAgent(agentName, () => runForAllOrgs(runSprintCompletionReporterForOrg));
      } catch (err) {
        logger.error({ err }, 'agent.sprint-completion-reporter.failed');
      } finally {
        const next = new Date();
        next.setUTCMinutes(next.getUTCMinutes() + 10);
        state[agentName].nextRun = next.toISOString();
      }
    }, 10 * 60_000);

    timers.push(completionTimer);
  }

  function stop() {
    for (const t of timers) clearInterval(t);
    timers.length = 0;
  }

  async function getStatus(orgPool) {
    await ensureAgentTables(orgPool);
    const dbRuns = await orgPool.query('SELECT agent_name, last_run, last_status FROM agent_runs');
    const byName = new Map(dbRuns.rows.map((r) => [String(r.agent_name), r]));

    const names = [
      AGENTS.STALE_TASK_DETECTOR,
      AGENTS.SPRINT_RISK_MONITOR,
      AGENTS.UNASSIGNED_TASK_ALERT,
      AGENTS.DAILY_STANDUP_COMPILER,
      AGENTS.SPRINT_COMPLETION_REPORTER,
    ];

    return names.map((name) => {
      const mem = state[name] || {};
      const dbRow = byName.get(name);
      const fallbackNext = SCHEDULES[name] ? nextRunIso(SCHEDULES[name]) : mem.nextRun || nowIso();

      return {
        name,
        lastRun: mem.lastRun || (dbRow?.last_run ? new Date(dbRow.last_run).toISOString() : null),
        nextRun: mem.nextRun || fallbackNext,
        status: pausedAgents.has(name) ? 'paused' : mem.status || dbRow?.last_status || 'idle',
      };
    });
  }

  function setAgentPaused(agentName, paused) {
    const normalized = String(agentName || '').trim();
    if (!normalized) return false;
    if (paused) pausedAgents.add(normalized);
    else pausedAgents.delete(normalized);
    state[normalized] = state[normalized] || { name: normalized, status: 'idle', lastRun: null, nextRun: nowIso() };
    state[normalized].status = paused ? 'paused' : 'idle';
    return true;
  }

  function setAllPaused(paused) {
    const names = [
      AGENTS.STALE_TASK_DETECTOR,
      AGENTS.SPRINT_RISK_MONITOR,
      AGENTS.UNASSIGNED_TASK_ALERT,
      AGENTS.DAILY_STANDUP_COMPILER,
      AGENTS.SPRINT_COMPLETION_REPORTER,
    ];
    for (const name of names) setAgentPaused(name, paused);
  }

  return { start, stop, getStatus, setAgentPaused, setAllPaused };
}

module.exports = {
  createMonitors,
};
