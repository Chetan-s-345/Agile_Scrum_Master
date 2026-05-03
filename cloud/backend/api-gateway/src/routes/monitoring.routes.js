const express = require('express');
const { z } = require('zod');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const router = express.Router();

router.use(authMiddleware, orgDbMiddleware);

const uuidSchema = z.string().uuid();

function daysBetweenInclusive(startIso, endIso) {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  const ms = end.getTime() - start.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(1, days);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function getActorMemberId(orgPool, userId) {
  const resp = await orgPool.query('SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1', [String(userId)]);
  return resp.rows[0]?.id || null;
}

router.get('/sprint/:sprintId/velocity', async (req, res, next) => {
  try {
    const parsed = z.object({ sprintId: uuidSchema }).safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid sprintId', details: parsed.error.flatten() });
    }

    const { sprintId } = parsed.data;
    const orgPool = req.orgDb;

    const sprintResp = await orgPool.query(
      `SELECT id, planned_points, start_date, end_date
       FROM sprints
       WHERE id = $1`,
      [String(sprintId)]
    );
    const sprint = sprintResp.rows[0];
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

    const todayIso = new Date().toISOString().slice(0, 10);
    const startIso = String(sprint.start_date);
    const endIso = String(sprint.end_date);

    const sprintDays = daysBetweenInclusive(startIso, endIso);
    const elapsedDays = clamp(daysBetweenInclusive(startIso, todayIso), 1, sprintDays);
    const daysRemaining = clamp(daysBetweenInclusive(todayIso, endIso) - 1, 0, sprintDays);

    const planned = Number(sprint.planned_points || 0);

    const doneResp = await orgPool.query(
      `SELECT COALESCE(SUM(story_points), 0)::int AS done_points
       FROM tasks
       WHERE sprint_id = $1 AND status = 'done'`,
      [String(sprintId)]
    );
    const completedPoints = Number(doneResp.rows[0]?.done_points || 0);
    const remainingPoints = Math.max(0, planned - completedPoints);

    const currentVelocity = elapsedDays > 0 ? completedPoints / elapsedDays : 0;
    const requiredVelocity = daysRemaining > 0 ? remainingPoints / daysRemaining : remainingPoints;
    const gapPct = requiredVelocity > 0 ? ((requiredVelocity - currentVelocity) / requiredVelocity) * 100 : 0;
    const onTrack = currentVelocity >= requiredVelocity;

    return res.status(200).json({
      currentVelocity: Math.round(currentVelocity * 100) / 100,
      requiredVelocity: Math.round(requiredVelocity * 100) / 100,
      gapPct: Math.round(gapPct * 100) / 100,
      onTrack,
      daysRemaining,
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/sprint/:sprintId/alerts', async (req, res, next) => {
  try {
    const parsed = z.object({ sprintId: uuidSchema }).safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid sprintId', details: parsed.error.flatten() });
    }

    const { sprintId } = parsed.data;
    const orgPool = req.orgDb;

    const acknowledgedQ = String(req.query.acknowledged || '').toLowerCase();
    const filterAcknowledgedFalse = acknowledgedQ === 'false';

    const resp = await orgPool.query(
      `SELECT id, alert_type, severity, title, message, suggestion, created_at, acknowledged, suggestion_action, target_task_id, action_taken
       FROM delay_alerts
       WHERE sprint_id = $1
         AND ($2::boolean IS FALSE OR acknowledged = FALSE)
       ORDER BY created_at DESC
       LIMIT 500`,
      [String(sprintId), filterAcknowledgedFalse]
    );

    const items = (resp.rows || []).map((r) => ({
      id: r.id,
      alertType: r.alert_type,
      severity: r.severity,
      title: r.title,
      message: r.message,
      suggestion: r.suggestion,
      createdAt: r.created_at,
      acknowledged: Boolean(r.acknowledged),
      suggestionAction: r.suggestion_action,
      targetTaskId: r.target_task_id,
      actionTaken: r.action_taken,
    }));

    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
});

router.patch('/alerts/:alertId/acknowledge', async (req, res, next) => {
  try {
    const parsedParams = z.object({ alertId: uuidSchema }).safeParse(req.params);
    if (!parsedParams.success) {
      return res.status(400).json({ error: 'Invalid alertId', details: parsedParams.error.flatten() });
    }

    const bodySchema = z.object({
      actionTaken: z.string().min(1).optional(),
    });
    const parsedBody = bodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      return res.status(400).json({ error: 'Invalid request body', details: parsedBody.error.flatten() });
    }

    const { alertId } = parsedParams.data;
    const { actionTaken } = parsedBody.data;

    const orgPool = req.orgDb;
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);

    const alertResp = await orgPool.query(
      `SELECT * FROM delay_alerts WHERE id = $1`,
      [String(alertId)]
    );
    const alert = alertResp.rows[0];
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    await orgPool.query(
      `UPDATE delay_alerts
       SET acknowledged = TRUE,
           acknowledged_by = $2,
           acknowledged_at = NOW(),
           action_taken = COALESCE($3, action_taken)
       WHERE id = $1`,
      [String(alertId), actorMemberId, actionTaken || null]
    );

    return res.status(200).json({ ok: true, moved: false, movedToSprintId: null });
  } catch (err) {
    return next(err);
  }
});

router.get('/burnout', async (req, res, next) => {
  try {
    const orgPool = req.orgDb;

    const resp = await orgPool.query(
      `SELECT
         dp.id AS developer_id,
         tm.full_name,
         dp.consecutive_over_capacity,
         ba.consecutive_over_sprints,
         ba.avg_overload_percentage,
         ba.alert_level
       FROM developer_profiles dp
       JOIN team_members tm ON tm.id = dp.member_id
       LEFT JOIN LATERAL (
         SELECT consecutive_over_sprints, avg_overload_percentage, alert_level
         FROM burnout_alerts
         WHERE developer_id = dp.id AND resolved = FALSE
         ORDER BY triggered_at DESC
         LIMIT 1
       ) ba ON TRUE
       WHERE dp.burnout_risk_flag = TRUE
       ORDER BY COALESCE(ba.alert_level, 'warning') DESC, tm.full_name ASC`,
      []
    );

    const items = (resp.rows || []).map((r) => ({
      developerId: r.developer_id,
      name: r.full_name,
      consecutiveOverSprints: Number(r.consecutive_over_sprints || r.consecutive_over_capacity || 0),
      avgOverloadPct: Number(r.avg_overload_percentage || 0),
      alertLevel: r.alert_level || 'warning',
    }));

    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
});

router.get('/capacity', async (req, res, next) => {
  try {
    const orgPool = req.orgDb;

    const resp = await orgPool.query(
      `SELECT
         dp.id AS developer_id,
         tm.full_name,
         dp.primary_role,
         dp.max_sprint_capacity,
         dp.current_sprint_load,
         (dp.max_sprint_capacity - dp.current_sprint_load) AS remaining_capacity,
         ROUND((dp.current_sprint_load::DECIMAL / NULLIF(dp.max_sprint_capacity, 0)) * 100, 2) AS utilization_pct,
         dp.merit_score,
         dp.burnout_risk_flag,
         dp.availability_status
       FROM developer_profiles dp
       JOIN team_members tm ON tm.id = dp.member_id
       WHERE tm.is_active = TRUE
       ORDER BY (dp.max_sprint_capacity - dp.current_sprint_load) DESC, tm.full_name ASC`,
      []
    );

    const items = (resp.rows || []).map((r) => ({
      developerId: r.developer_id,
      name: r.full_name,
      role: r.primary_role,
      maxSprintCapacity: Number(r.max_sprint_capacity || 0),
      currentSprintLoad: Number(r.current_sprint_load || 0),
      remainingCapacity: Number(r.remaining_capacity || 0),
      utilizationPct: Number(r.utilization_pct || 0),
      meritScore: Number(r.merit_score || 0),
      burnoutRiskFlag: Boolean(r.burnout_risk_flag),
      availabilityStatus: String(r.availability_status || 'available'),
    }));

    const totals = items.reduce(
      (acc, i) => {
        acc.maxSprintCapacity += i.maxSprintCapacity;
        acc.currentSprintLoad += i.currentSprintLoad;
        return acc;
      },
      { maxSprintCapacity: 0, currentSprintLoad: 0 }
    );

    const overallUtilizationPct = totals.maxSprintCapacity > 0 ? Math.round((totals.currentSprintLoad / totals.maxSprintCapacity) * 10000) / 100 : 0;

    return res.status(200).json({ items, totals: { ...totals, overallUtilizationPct } });
  } catch (err) {
    return next(err);
  }
});

router.get('/developer-activity', async (req, res, next) => {
  try {
    const orgPool = req.orgDb;
    const sprintId = String(req.query.sprintId || '').trim();
    const developerId = String(req.query.developerId || '').trim();
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 50)));

    const hasGithubEventsResp = await orgPool.query(`SELECT to_regclass('github_events') AS name`);
    const hasGithubEvents = Boolean(hasGithubEventsResp.rows[0]?.name);
    if (!hasGithubEvents) {
      return res.status(200).json({
        summary: {
          totalEvents: 0,
          commitCount: 0,
          pullRequestCount: 0,
          reviewCount: 0,
          issueCount: 0,
          pushCount: 0,
          additions: 0,
          deletions: 0,
          activeDays: 0,
          lastEventAt: null,
        },
        events: [],
        byDeveloper: [],
      });
    }

    const where = [];
    const params = [];
    const addFilter = (expr, value) => {
      params.push(value);
      where.push(expr.replace('?', `$${params.length}`));
    };

    if (sprintId) addFilter('t.sprint_id = ?', sprintId);
    if (developerId) addFilter('ge.developer_id = ?', developerId);

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const summaryResp = await orgPool.query(
      `SELECT
         COUNT(*)::int AS total_events,
         COUNT(*) FILTER (WHERE ge.github_commit_sha IS NOT NULL OR ge.event_type IN ('commit'))::int AS commit_count,
         COUNT(*) FILTER (WHERE ge.event_type IN ('pull_request', 'pull_request_opened', 'pull_request_closed', 'pr_opened', 'pr_merged'))::int AS pull_request_count,
         COUNT(*) FILTER (WHERE ge.event_type IN ('review', 'pull_request_review'))::int AS review_count,
         COUNT(*) FILTER (WHERE ge.event_type IN ('issue', 'issues'))::int AS issue_count,
         COUNT(*) FILTER (WHERE ge.event_type IN ('push'))::int AS push_count,
         COALESCE(SUM(ge.additions), 0)::int AS additions,
         COALESCE(SUM(ge.deletions), 0)::int AS deletions,
         COUNT(DISTINCT ge.event_at::date)::int AS active_days,
         MAX(ge.event_at) AS last_event_at
       FROM github_events ge
       LEFT JOIN tasks t ON t.id = ge.task_id
       ${whereSql}`,
      params
    );

    params.push(limit);
    const eventsResp = await orgPool.query(
      `SELECT
         ge.id,
         ge.event_type,
         ge.repo_name,
         ge.github_commit_sha,
         ge.github_pr_number,
         ge.branch_name,
         ge.additions,
         ge.deletions,
         ge.event_at,
         t.id AS task_id,
         t.title AS task_title,
         t.sprint_id,
         tm.full_name AS developer_name,
         dp.id AS developer_id
       FROM github_events ge
       LEFT JOIN tasks t ON t.id = ge.task_id
       LEFT JOIN developer_profiles dp ON dp.id = ge.developer_id
       LEFT JOIN team_members tm ON tm.id = dp.member_id
       ${whereSql}
       ORDER BY ge.event_at DESC
       LIMIT $${params.length}`,
      params
    );

    const byDevResp = await orgPool.query(
      `SELECT
         COALESCE(tm.full_name, 'Unknown') AS developer_name,
         dp.id AS developer_id,
         COUNT(*)::int AS total_events,
         COUNT(*) FILTER (WHERE ge.github_commit_sha IS NOT NULL OR ge.event_type IN ('commit'))::int AS commit_count,
         COUNT(*) FILTER (WHERE ge.event_type IN ('pull_request', 'pull_request_opened', 'pull_request_closed', 'pr_opened', 'pr_merged'))::int AS pull_request_count,
         COUNT(*) FILTER (WHERE ge.event_type IN ('review', 'pull_request_review'))::int AS review_count,
         COALESCE(SUM(ge.additions), 0)::int AS additions,
         COALESCE(SUM(ge.deletions), 0)::int AS deletions,
         MAX(ge.event_at) AS last_event_at
       FROM github_events ge
       LEFT JOIN tasks t ON t.id = ge.task_id
       LEFT JOIN developer_profiles dp ON dp.id = ge.developer_id
       LEFT JOIN team_members tm ON tm.id = dp.member_id
       ${whereSql}
       GROUP BY COALESCE(tm.full_name, 'Unknown'), dp.id
       ORDER BY total_events DESC, commit_count DESC
       LIMIT 30`,
      params.slice(0, where.length)
    );

    const summary = summaryResp.rows[0] || {};
    const events = (eventsResp.rows || []).map((r) => ({
      id: r.id,
      eventType: r.event_type,
      repoName: r.repo_name || null,
      developerId: r.developer_id || null,
      developerName: r.developer_name || 'Unknown',
      taskId: r.task_id || null,
      taskTitle: r.task_title || null,
      sprintId: r.sprint_id || null,
      commitSha: r.github_commit_sha || null,
      pullRequestNumber: r.github_pr_number || null,
      branchName: r.branch_name || null,
      additions: Number(r.additions || 0),
      deletions: Number(r.deletions || 0),
      eventAt: r.event_at,
    }));

    const byDeveloper = (byDevResp.rows || []).map((r) => ({
      developerId: r.developer_id || null,
      developerName: r.developer_name,
      totalEvents: Number(r.total_events || 0),
      commitCount: Number(r.commit_count || 0),
      pullRequestCount: Number(r.pull_request_count || 0),
      reviewCount: Number(r.review_count || 0),
      additions: Number(r.additions || 0),
      deletions: Number(r.deletions || 0),
      lastEventAt: r.last_event_at || null,
    }));

    return res.status(200).json({
      summary: {
        totalEvents: Number(summary.total_events || 0),
        commitCount: Number(summary.commit_count || 0),
        pullRequestCount: Number(summary.pull_request_count || 0),
        reviewCount: Number(summary.review_count || 0),
        issueCount: Number(summary.issue_count || 0),
        pushCount: Number(summary.push_count || 0),
        additions: Number(summary.additions || 0),
        deletions: Number(summary.deletions || 0),
        activeDays: Number(summary.active_days || 0),
        lastEventAt: summary.last_event_at || null,
      },
      events,
      byDeveloper,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
