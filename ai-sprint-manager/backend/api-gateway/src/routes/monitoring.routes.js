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
      confirmMove: z.boolean().optional(),
    });
    const parsedBody = bodySchema.safeParse(req.body || {});
    if (!parsedBody.success) {
      return res.status(400).json({ error: 'Invalid request body', details: parsedBody.error.flatten() });
    }

    const { alertId } = parsedParams.data;
    const { actionTaken, confirmMove } = parsedBody.data;

    const orgPool = req.orgDb;
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);

    const alertResp = await orgPool.query(
      `SELECT * FROM delay_alerts WHERE id = $1`,
      [String(alertId)]
    );
    const alert = alertResp.rows[0];
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    let moved = false;
    let movedToSprintId = null;

    await orgPool.query('BEGIN');
    try {
      if (confirmMove && String(alert.suggestion_action) === 'move_to_next_sprint' && alert.target_task_id) {
        const sprintResp = await orgPool.query('SELECT id, project_id, end_date FROM sprints WHERE id = $1', [String(alert.sprint_id)]);
        const sprint = sprintResp.rows[0];
        if (sprint) {
          const nextResp = await orgPool.query(
            `SELECT id
             FROM sprints
             WHERE project_id = $1
               AND status = 'planning'
               AND start_date > $2::date
             ORDER BY start_date ASC
             LIMIT 1`,
            [String(sprint.project_id), String(sprint.end_date)]
          );
          const nextSprint = nextResp.rows[0];
          if (nextSprint) {
            await orgPool.query(
              `UPDATE tasks SET sprint_id = $2, updated_at = NOW() WHERE id = $1`,
              [String(alert.target_task_id), String(nextSprint.id)]
            );
            moved = true;
            movedToSprintId = String(nextSprint.id);
          }
        }
      }

      await orgPool.query(
        `UPDATE delay_alerts
         SET acknowledged = TRUE,
             acknowledged_by = $2,
             acknowledged_at = NOW(),
             action_taken = COALESCE($3, action_taken)
         WHERE id = $1`,
        [String(alertId), actorMemberId, actionTaken || null]
      );

      await orgPool.query('COMMIT');
    } catch (err) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }

    return res.status(200).json({ ok: true, moved, movedToSprintId });
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
      `SELECT full_name, primary_role, max_sprint_capacity, current_sprint_load, remaining_capacity, utilization_pct, merit_score, burnout_risk_flag
       FROM v_team_capacity
       ORDER BY remaining_capacity DESC`,
      []
    );

    const items = (resp.rows || []).map((r) => ({
      name: r.full_name,
      role: r.primary_role,
      maxSprintCapacity: Number(r.max_sprint_capacity || 0),
      currentSprintLoad: Number(r.current_sprint_load || 0),
      remainingCapacity: Number(r.remaining_capacity || 0),
      utilizationPct: Number(r.utilization_pct || 0),
      meritScore: Number(r.merit_score || 0),
      burnoutRiskFlag: Boolean(r.burnout_risk_flag),
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

module.exports = router;
