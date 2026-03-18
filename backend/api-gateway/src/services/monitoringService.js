const { db } = require('../config/database');
const { logger } = require('../middleware/logger');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function isoDate(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(startIso, endIso) {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  const ms = end.getTime() - start.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(1, days);
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

class MonitoringService {
  async takeDailySnapshot(sprintId, orgPool) {
    const todayIso = new Date().toISOString().slice(0, 10);

    const sprintResp = await orgPool.query(
      `SELECT id, project_id, planned_points, start_date, end_date
       FROM sprints
       WHERE id = $1`,
      [String(sprintId)]
    );
    const sprint = sprintResp.rows[0];
    if (!sprint) throw Object.assign(new Error('Sprint not found'), { statusCode: 404 });

    const plannedPoints = Number(sprint.planned_points || 0);
    const startIso = isoDate(sprint.start_date);
    const endIso = isoDate(sprint.end_date);
    if (!startIso || !endIso) throw Object.assign(new Error('Sprint has invalid dates'), { statusCode: 400 });

    const sprintDays = daysBetweenInclusive(startIso, endIso);
    const dayNumber = clamp(daysBetweenInclusive(startIso, todayIso), 1, sprintDays);

    const remainingDays = clamp(sprintDays - dayNumber, 0, sprintDays);

    const pointsResp = await orgPool.query(
      `SELECT
         COALESCE(SUM(story_points) FILTER (WHERE status = 'done'), 0)::int AS done_points,
         COALESCE(SUM(story_points) FILTER (WHERE status = 'done' AND completed_at::date = $2::date), 0)::int AS done_points_today
       FROM tasks
       WHERE sprint_id = $1`,
      [String(sprintId), todayIso]
    );
    const donePoints = Number(pointsResp.rows[0]?.done_points || 0);
    const donePointsToday = Number(pointsResp.rows[0]?.done_points_today || 0);

    const countsResp = await orgPool.query(
      `SELECT
         COUNT(*)::int AS tasks_total,
         COUNT(*) FILTER (WHERE status = 'done')::int AS tasks_done,
         COUNT(*) FILTER (WHERE status = 'in_progress')::int AS tasks_in_progress,
         COUNT(*) FILTER (WHERE status = 'blocked')::int AS tasks_blocked
       FROM tasks
       WHERE sprint_id = $1`,
      [String(sprintId)]
    );
    const counts = countsResp.rows[0] || {};

    const idealRemaining = clamp(plannedPoints - (plannedPoints / sprintDays) * dayNumber, 0, plannedPoints);
    const actualRemaining = clamp(plannedPoints - donePoints, 0, plannedPoints);

    const currentVelocity = dayNumber > 0 ? donePoints / dayNumber : 0;
    const requiredVelocity = remainingDays > 0 ? actualRemaining / remainingDays : actualRemaining;
    const velocityGapPct = requiredVelocity > 0 ? ((requiredVelocity - currentVelocity) / requiredVelocity) * 100 : 0;

    const availResp = await orgPool.query(
      `SELECT COUNT(*)::int AS available_devs
       FROM developer_profiles dp
       JOIN team_members tm ON tm.id = dp.member_id
       WHERE tm.is_active = TRUE AND dp.availability_status = 'available'`
    );
    const availableDevs = Number(availResp.rows[0]?.available_devs || 0);

    const velComponent = clamp(Math.max(0, velocityGapPct), 0, 100) * 0.7;
    const blockedComponent = clamp(Number(counts.tasks_blocked || 0) * 5, 0, 30);
    const availabilityComponent = availableDevs === 0 ? 20 : 0;
    const delayRiskScore = clamp(Math.round((velComponent + blockedComponent + availabilityComponent) * 100) / 100, 0, 100);

    const delayPredictedDays = currentVelocity > 0 ? Math.max(0, Math.ceil(actualRemaining / currentVelocity) - remainingDays) : actualRemaining > 0 ? remainingDays : 0;
    const predictedCompletionDate = currentVelocity > 0 && actualRemaining > 0 ? addDays(todayIso, Math.ceil(actualRemaining / currentVelocity)) : null;

    await orgPool.query(
      `INSERT INTO sprint_progress_snapshots (
         sprint_id, snapshot_date, day_number,
         ideal_points_remaining, actual_points_remaining, points_completed_today,
         current_velocity, required_velocity, velocity_gap_pct,
         tasks_total, tasks_done, tasks_in_progress, tasks_blocked,
         predicted_completion_date, delay_risk_score, delay_predicted_days
       ) VALUES (
         $1,$2::date,$3,
         $4,$5,$6,
         $7,$8,$9,
         $10,$11,$12,$13,
         $14::date,$15,$16
       )
       ON CONFLICT (sprint_id, snapshot_date) DO UPDATE SET
         day_number = EXCLUDED.day_number,
         ideal_points_remaining = EXCLUDED.ideal_points_remaining,
         actual_points_remaining = EXCLUDED.actual_points_remaining,
         points_completed_today = EXCLUDED.points_completed_today,
         current_velocity = EXCLUDED.current_velocity,
         required_velocity = EXCLUDED.required_velocity,
         velocity_gap_pct = EXCLUDED.velocity_gap_pct,
         tasks_total = EXCLUDED.tasks_total,
         tasks_done = EXCLUDED.tasks_done,
         tasks_in_progress = EXCLUDED.tasks_in_progress,
         tasks_blocked = EXCLUDED.tasks_blocked,
         predicted_completion_date = EXCLUDED.predicted_completion_date,
         delay_risk_score = EXCLUDED.delay_risk_score,
         delay_predicted_days = EXCLUDED.delay_predicted_days`,
      [
        String(sprintId),
        todayIso,
        Number(dayNumber),
        Number(idealRemaining),
        Number(actualRemaining),
        Number(donePointsToday),
        Number(currentVelocity),
        Number(requiredVelocity),
        Number(velocityGapPct),
        Number(counts.tasks_total || 0),
        Number(counts.tasks_done || 0),
        Number(counts.tasks_in_progress || 0),
        Number(counts.tasks_blocked || 0),
        predictedCompletionDate,
        Number(delayRiskScore),
        Number(delayPredictedDays || 0),
      ]
    );

    await this.checkDelayThreshold(String(sprintId), Number(velocityGapPct), orgPool);

    return {
      sprintId: String(sprintId),
      snapshotDate: todayIso,
      dayNumber,
      idealRemaining,
      actualRemaining,
      currentVelocity,
      requiredVelocity,
      velocityGapPct,
      delayRiskScore,
      delayPredictedDays,
      predictedCompletionDate,
    };
  }

  async checkDelayThreshold(sprintId, velocityGapPct, orgPool) {
    const thresholdResp = await orgPool.query('SELECT delay_alert_threshold FROM org_settings LIMIT 1');
    const threshold = Number(thresholdResp.rows[0]?.delay_alert_threshold || 20);

    const sev = velocityGapPct > 40 ? 'critical' : 'warning';

    if (Number(velocityGapPct) > threshold) {
      const riskyResp = await orgPool.query(
        `SELECT id, title, assignee_id
         FROM tasks
         WHERE sprint_id = $1 AND status = 'in_progress'
         ORDER BY COALESCE(updated_at, created_at) ASC
         LIMIT 1`,
        [String(sprintId)]
      );
      const risky = riskyResp.rows[0] || null;

      const title = velocityGapPct > 40 ? 'Critical: Sprint velocity gap' : 'Warning: Sprint velocity gap';
      const message = `Velocity gap ${Math.round(Number(velocityGapPct) * 100) / 100}% exceeds threshold ${threshold}%. Consider reducing scope, unblocking work, or reassigning.`;
      const suggestion = risky
        ? `Consider moving task "${String(risky.title)}" to the next sprint or reassigning it to unblock progress.`
        : 'Consider reducing scope or increasing capacity to close the velocity gap.';

      await orgPool.query(
        `INSERT INTO delay_alerts (
           sprint_id, task_id, developer_id,
           alert_type, severity, title, message,
           predicted_delay_days, suggestion, suggestion_action, target_task_id
         )
         SELECT $1, NULL, NULL, 'sprint_delay', $2, $3, $4, $5, $6, $7, $8
         WHERE NOT EXISTS (
           SELECT 1 FROM delay_alerts
           WHERE sprint_id = $1 AND alert_type = 'sprint_delay' AND acknowledged = FALSE
             AND created_at::date = CURRENT_DATE
         )`,
        [
          String(sprintId),
          String(sev),
          String(title),
          String(message),
          0,
          String(suggestion),
          risky ? 'move_to_next_sprint' : null,
          risky ? String(risky.id) : null,
        ]
      );
    }

    // Past due tasks → per-task alerts (best-effort, avoid duplicates per day)
    const overdueResp = await orgPool.query(
      `SELECT id, title, due_date
       FROM tasks
       WHERE sprint_id = $1
         AND due_date IS NOT NULL
         AND due_date::date < CURRENT_DATE
         AND status NOT IN ('done', 'cancelled')`,
      [String(sprintId)]
    );

    for (const t of overdueResp.rows || []) {
      await orgPool.query(
        `INSERT INTO delay_alerts (
           sprint_id, task_id, developer_id,
           alert_type, severity, title, message,
           predicted_delay_days, suggestion
         )
         SELECT $1,$2,NULL,'task_overdue','warning',$3,$4,0,$5
         WHERE NOT EXISTS (
           SELECT 1 FROM delay_alerts
           WHERE task_id = $2 AND alert_type = 'task_overdue'
             AND acknowledged = FALSE
             AND created_at::date = CURRENT_DATE
         )`,
        [
          String(sprintId),
          String(t.id),
          `Task overdue: ${String(t.title)}`,
          `Task is past due (due ${isoDate(t.due_date)}).`,
          'Review due date, split scope, or reassign to avoid sprint delay.',
        ]
      );
    }
  }

  async runAllActiveSprintSnapshots() {
    const universal = db.universalPool;

    // Best-effort: try to filter active-ish orgs if status exists.
    let orgRows = [];
    try {
      const colsResp = await universal.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizations'"
      );
      const cols = new Set(colsResp.rows.map((r) => r.column_name));
      const hasStatus = cols.has('status');

      if (hasStatus) {
        const resp = await universal.query(
          "SELECT id FROM organizations WHERE status IN ('trial','active')"
        );
        orgRows = resp.rows;
      } else {
        const resp = await universal.query('SELECT id FROM organizations');
        orgRows = resp.rows;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to list orgs for monitoring; falling back to empty');
      orgRows = [];
    }

    const result = { orgsProcessed: 0, sprintsProcessed: 0, errors: [] };

    for (const row of orgRows) {
      const orgId = row?.id;
      if (!orgId) continue;

      let orgPool = null;
      try {
        orgPool = await db.getOrgPool(String(orgId));
      } catch (err) {
        result.errors.push({ orgId: String(orgId), error: String(err?.message || err) });
        continue;
      }

      result.orgsProcessed += 1;

      try {
        const sprintsResp = await orgPool.query("SELECT id FROM sprints WHERE status = 'active'");
        const sprintIds = (sprintsResp.rows || []).map((r) => r.id).filter(Boolean);

        for (const sprintId of sprintIds) {
          try {
            await this.takeDailySnapshot(String(sprintId), orgPool);
            result.sprintsProcessed += 1;
          } catch (err) {
            result.errors.push({ orgId: String(orgId), sprintId: String(sprintId), error: String(err?.message || err) });
          }
        }
      } catch (err) {
        result.errors.push({ orgId: String(orgId), error: String(err?.message || err) });
      }
    }

    return result;
  }
}

const monitoringService = new MonitoringService();

module.exports = {
  MonitoringService,
  monitoringService,
};
