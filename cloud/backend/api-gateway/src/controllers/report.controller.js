function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPct(numerator, denominator) {
  if (!denominator || Number(denominator) <= 0) return null;
  return Math.round((Number(numerator || 0) / Number(denominator)) * 1000) / 10;
}

function dateOnly(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function csvEscape(value) {
  const source = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(source)) return `"${source.replace(/"/g, '""')}"`;
  return source;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function summarizeRiskLevel(score) {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

async function listReports(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const sprintResp = await orgPool.query(
      `SELECT id, name, status, start_date, end_date, planned_points, completed_points
       FROM sprints
       WHERE status IN ('active','completed')
       ORDER BY start_date DESC
       LIMIT 12`
    );

    const sprints = sprintResp.rows || [];
    const sprintIds = sprints.map((s) => String(s.id));

    const burnoutResp = sprintIds.length
      ? await orgPool.query(
          `SELECT
             sp.sprint_id,
             COUNT(*) FILTER (WHERE sp.over_capacity = TRUE)::int AS at_risk_count,
             ROUND(AVG(
               CASE
                 WHEN sp.max_capacity_pts > 0
                 THEN ((sp.story_points_assigned - sp.max_capacity_pts)::numeric / sp.max_capacity_pts::numeric) * 100
                 ELSE NULL
               END
             ), 2) AS avg_overload_pct
           FROM sprint_performance sp
           WHERE sp.sprint_id = ANY($1::uuid[])
           GROUP BY sp.sprint_id`,
          [sprintIds]
        )
      : { rows: [] };

    const blockedResp = sprintIds.length
      ? await orgPool.query(
          `SELECT sprint_id, COUNT(*)::int AS blocked_count
           FROM tasks
           WHERE sprint_id = ANY($1::uuid[])
             AND status = 'blocked'
           GROUP BY sprint_id`,
          [sprintIds]
        )
      : { rows: [] };

    const riskResp = sprintIds.length
      ? await orgPool.query(
          `SELECT DISTINCT ON (sps.sprint_id)
             sps.sprint_id,
             sps.delay_risk_score
           FROM sprint_progress_snapshots sps
           WHERE sps.sprint_id = ANY($1::uuid[])
           ORDER BY sps.sprint_id, sps.snapshot_date DESC`,
          [sprintIds]
        )
      : { rows: [] };

    const alertResp = sprintIds.length
      ? await orgPool.query(
          `SELECT sprint_id, severity, COUNT(*)::int AS total
           FROM delay_alerts
           WHERE sprint_id = ANY($1::uuid[])
             AND acknowledged = FALSE
           GROUP BY sprint_id, severity`,
          [sprintIds]
        )
      : { rows: [] };

    const openBurnoutResp = await orgPool.query(
      `SELECT COUNT(*)::int AS total
       FROM burnout_alerts
       WHERE resolved = FALSE`
    );

    const unresolvedAlertsResp = await orgPool.query(
      `SELECT COUNT(*)::int AS total
       FROM delay_alerts
       WHERE acknowledged = FALSE`
    );

    const burnoutBySprint = new Map();
    for (const row of burnoutResp.rows || []) {
      burnoutBySprint.set(String(row.sprint_id), {
        atRiskCount: num(row.at_risk_count),
        avgOverloadPct: num(row.avg_overload_pct),
      });
    }

    const blockedBySprint = new Map();
    for (const row of blockedResp.rows || []) {
      blockedBySprint.set(String(row.sprint_id), num(row.blocked_count));
    }

    const riskBySprint = new Map();
    for (const row of riskResp.rows || []) {
      const score = num(row.delay_risk_score);
      riskBySprint.set(String(row.sprint_id), {
        riskScore: score,
        riskLevel: summarizeRiskLevel(score),
      });
    }

    const alertsBySprint = new Map();
    for (const row of alertResp.rows || []) {
      const sprintId = String(row.sprint_id);
      const bucket = alertsBySprint.get(sprintId) || {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
      };
      const severity = String(row.severity || '').toLowerCase();
      const count = num(row.total);
      bucket.total += count;
      if (severity === 'critical') bucket.critical += count;
      else if (severity === 'warning') bucket.warning += count;
      else bucket.info += count;
      alertsBySprint.set(sprintId, bucket);
    }

    const velocityHistory = [...sprints]
      .reverse()
      .map((s) => ({
        sprintId: s.id,
        sprint: s.name,
        status: s.status,
        startDate: s.start_date,
        endDate: s.end_date,
        planned: Number(s.planned_points || 0),
        velocity: Number(s.completed_points || 0),
        completionPct:
          s.planned_points && Number(s.planned_points) > 0
            ? Math.round((Number(s.completed_points || 0) / Number(s.planned_points)) * 1000) / 10
            : null,
      }));

    const burnoutTrend = [...sprints]
      .reverse()
      .map((s) => {
        const bucket = burnoutBySprint.get(String(s.id)) || { atRiskCount: 0, avgOverloadPct: 0 };
        return {
          sprintId: s.id,
          sprint: s.name,
          atRiskCount: bucket.atRiskCount,
          avgOverloadPct: bucket.avgOverloadPct,
        };
      });

    const blockerTrend = [...sprints]
      .reverse()
      .map((s) => ({
        sprintId: s.id,
        sprint: s.name,
        blockedCount: blockedBySprint.get(String(s.id)) || 0,
      }));

    const riskTrend = [...sprints]
      .reverse()
      .map((s) => {
        const risk = riskBySprint.get(String(s.id)) || { riskScore: 0, riskLevel: 'low' };
        return {
          sprintId: s.id,
          sprint: s.name,
          riskScore: risk.riskScore,
          riskLevel: risk.riskLevel,
        };
      });

    const recentReports = sprints.slice(0, 10).map((s) => {
      const alerts = alertsBySprint.get(String(s.id)) || { total: 0, critical: 0, warning: 0, info: 0 };
      const burnout = burnoutBySprint.get(String(s.id)) || { atRiskCount: 0, avgOverloadPct: 0 };
      const blockers = blockedBySprint.get(String(s.id)) || 0;
      const risk = riskBySprint.get(String(s.id)) || { riskScore: 0, riskLevel: 'low' };

      return {
        id: s.id,
        name: `${s.name} Report`,
        sprint: s.name,
        date: s.end_date || s.start_date,
        type: s.status === 'active' ? 'In-Progress' : 'Sprint Summary',
        planned: num(s.planned_points),
        completed: num(s.completed_points),
        completionPct: toPct(s.completed_points, s.planned_points),
        blockedCount: blockers,
        burnoutRiskCount: burnout.atRiskCount,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        alerts,
      };
    });

    const avgVelocity = velocityHistory.length
      ? Math.round((velocityHistory.reduce((acc, item) => acc + num(item.velocity), 0) / velocityHistory.length) * 100) / 100
      : 0;

    const completionValues = velocityHistory.map((item) => item.completionPct).filter((item) => typeof item === 'number');
    const avgCompletionPct = completionValues.length
      ? Math.round((completionValues.reduce((acc, item) => acc + num(item), 0) / completionValues.length) * 10) / 10
      : null;

    const latestSprint = velocityHistory.length ? velocityHistory[velocityHistory.length - 1] : null;

    return res.status(200).json({
      summary: {
        avgVelocity,
        avgCompletionPct,
        activeOrRecentSprint: latestSprint?.sprint || null,
        openBurnoutFlags: num(openBurnoutResp.rows[0]?.total),
        unresolvedAlerts: num(unresolvedAlertsResp.rows[0]?.total),
      },
      velocityHistory,
      burnoutTrend,
      blockerTrend,
      riskTrend,
      reports: recentReports,
      descriptions: {
        velocity: 'Tracks story points completed per sprint versus planned effort to highlight delivery consistency.',
        burnout: 'Shows overloaded contributors by sprint so Scrum Masters can rebalance capacity before quality drops.',
        blockers: 'Summarizes blocked tasks over time to identify recurring dependencies and process friction.',
        risk: 'Uses latest sprint progress snapshots to expose probability of delay and escalation level.',
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function getSprintReport(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const sprintId = String(req.params?.sprintId || '');
    if (!sprintId) return res.status(400).json({ error: 'Invalid sprintId' });

    const sprintResp = await orgPool.query(
      `SELECT id, name, status, start_date, end_date, planned_points, completed_points
       FROM sprints
       WHERE id = $1
       LIMIT 1`,
      [sprintId]
    );
    const sprint = sprintResp.rows[0] || null;
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

    const [
      burndownResp,
      riskSnapshotResp,
      blockedResp,
      alertsResp,
      tasksByStatusResp,
      contributorsResp,
      burnoutResp,
      meetingResp,
    ] = await Promise.all([
      orgPool.query(
        `SELECT day_number, snapshot_date, ideal_points_remaining, actual_points_remaining, delay_risk_score, velocity_gap_pct
         FROM sprint_progress_snapshots
         WHERE sprint_id = $1
         ORDER BY snapshot_date ASC`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT delay_risk_score, velocity_gap_pct, tasks_blocked
         FROM sprint_progress_snapshots
         WHERE sprint_id = $1
         ORDER BY snapshot_date DESC
         LIMIT 1`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT COUNT(*)::int AS blocked_count
         FROM tasks
         WHERE sprint_id = $1 AND status = 'blocked'`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT id, severity, title, message, suggestion, acknowledged, created_at
         FROM delay_alerts
         WHERE sprint_id = $1
         ORDER BY created_at DESC
         LIMIT 40`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT status, COUNT(*)::int AS total, COALESCE(SUM(story_points), 0)::int AS story_points
         FROM tasks
         WHERE sprint_id = $1
         GROUP BY status`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT tm.full_name, sp.story_points_assigned, sp.story_points_completed, sp.tasks_completed, sp.over_capacity
         FROM sprint_performance sp
         JOIN developer_profiles dp ON dp.id = sp.developer_id
         JOIN team_members tm ON tm.id = dp.member_id
         WHERE sp.sprint_id = $1
         ORDER BY sp.story_points_completed DESC, sp.tasks_completed DESC
         LIMIT 10`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT tm.full_name, sp.story_points_assigned, sp.max_capacity_pts,
                CASE WHEN sp.max_capacity_pts > 0
                     THEN ROUND(((sp.story_points_assigned - sp.max_capacity_pts)::numeric / sp.max_capacity_pts::numeric) * 100, 2)
                     ELSE 0 END AS overload_pct,
                sp.over_capacity
         FROM sprint_performance sp
         JOIN developer_profiles dp ON dp.id = sp.developer_id
         JOIN team_members tm ON tm.id = dp.member_id
         WHERE sp.sprint_id = $1
         ORDER BY sp.over_capacity DESC, overload_pct DESC
         LIMIT 20`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT id, meeting_type, title, ai_summary, ai_decisions, ai_risks, ai_action_items, scheduled_start
         FROM meeting_sessions
         WHERE sprint_id = $1
         ORDER BY scheduled_start DESC
         LIMIT 20`,
        [sprintId]
      ),
    ]);

    const burndown = (burndownResp.rows || []).map((row) => ({
      day: num(row.day_number),
      date: dateOnly(row.snapshot_date),
      idealRemaining: num(row.ideal_points_remaining),
      actualRemaining: num(row.actual_points_remaining),
      delayRiskScore: num(row.delay_risk_score),
      velocityGapPct: num(row.velocity_gap_pct),
    }));

    const latestSnapshot = riskSnapshotResp.rows[0] || null;
    const riskScore = num(latestSnapshot?.delay_risk_score);
    const blockedCount = num(blockedResp.rows[0]?.blocked_count);
    const velocityGapPct = num(latestSnapshot?.velocity_gap_pct);

    const recommendations = [];
    if (blockedCount > 0) recommendations.push('Prioritize blocker removal with owner and ETA on each blocked task.');
    if (velocityGapPct > 20) recommendations.push('Reduce sprint scope or reassign high-point work to close velocity gap.');
    if (riskScore >= 50) recommendations.push('Run daily risk review with Scrum Master, Tech Lead, and product owner.');

    const alerts = (alertsResp.rows || []).map((row) => ({
      id: row.id,
      severity: String(row.severity || 'warning').toLowerCase(),
      title: row.title,
      message: row.message,
      suggestion: row.suggestion,
      acknowledged: Boolean(row.acknowledged),
      createdAt: row.created_at,
    }));

    const taskStatus = (tasksByStatusResp.rows || []).map((row) => ({
      status: row.status,
      count: num(row.total),
      storyPoints: num(row.story_points),
    }));

    const contributors = (contributorsResp.rows || []).map((row) => ({
      name: row.full_name,
      storyPointsAssigned: num(row.story_points_assigned),
      storyPointsCompleted: num(row.story_points_completed),
      tasksCompleted: num(row.tasks_completed),
      overCapacity: Boolean(row.over_capacity),
    }));

    const burnout = (burnoutResp.rows || []).map((row) => ({
      name: row.full_name,
      storyPointsAssigned: num(row.story_points_assigned),
      maxCapacity: num(row.max_capacity_pts),
      overloadPct: num(row.overload_pct),
      overCapacity: Boolean(row.over_capacity),
    }));

    const meetings = (meetingResp.rows || []).map((row) => ({
      id: row.id,
      type: row.meeting_type,
      title: row.title,
      summary: row.ai_summary,
      decisions: row.ai_decisions,
      risks: row.ai_risks,
      actionItems: Array.isArray(row.ai_action_items) ? row.ai_action_items : [],
      scheduledStart: row.scheduled_start,
    }));

    return res.status(200).json({
      sprint: {
        id: sprint.id,
        name: sprint.name,
        status: sprint.status,
        startDate: sprint.start_date,
        endDate: sprint.end_date,
        plannedPoints: num(sprint.planned_points),
        completedPoints: num(sprint.completed_points),
        completionPct: toPct(sprint.completed_points, sprint.planned_points),
      },
      burndown,
      risk: {
        riskScore,
        riskLevel: summarizeRiskLevel(riskScore),
        velocityGapPct,
        blockedCount,
        recommendations,
      },
      alerts,
      tasks: {
        byStatus: taskStatus,
        blockedCount,
      },
      contributors,
      burnout,
      meetings,
      descriptions: {
        overview: 'This sprint report combines delivery, risk, burnout, and meeting insights for Scrum Master review.',
        burndown: 'Burndown compares ideal versus actual remaining points to show whether sprint execution is stable.',
        risk: 'Risk summarizes delay probability from latest snapshots, blockers, and velocity gap.',
        burnout: 'Burnout highlights over-capacity contributors so assignments can be rebalanced early.',
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function exportSprintReportCsv(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const sprintId = String(req.params?.sprintId || '');
    if (!sprintId) return res.status(400).json({ error: 'Invalid sprintId' });

    const sprintResp = await orgPool.query(
      `SELECT id, name, status, start_date, end_date, planned_points, completed_points
       FROM sprints
       WHERE id = $1
       LIMIT 1`,
      [sprintId]
    );
    const sprint = sprintResp.rows[0] || null;
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

    const [tasksResp, alertsResp, burnoutResp] = await Promise.all([
      orgPool.query(
        `SELECT status, COUNT(*)::int AS total, COALESCE(SUM(story_points), 0)::int AS points
         FROM tasks
         WHERE sprint_id = $1
         GROUP BY status
         ORDER BY status ASC`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT severity, COUNT(*)::int AS total
         FROM delay_alerts
         WHERE sprint_id = $1
         GROUP BY severity
         ORDER BY severity ASC`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT COUNT(*) FILTER (WHERE over_capacity = TRUE)::int AS over_capacity_count
         FROM sprint_performance
         WHERE sprint_id = $1`,
        [sprintId]
      ),
    ]);

    const rows = [];
    rows.push(['Section', 'Metric', 'Value']);
    rows.push(['Sprint', 'Name', sprint.name]);
    rows.push(['Sprint', 'Status', sprint.status]);
    rows.push(['Sprint', 'Start Date', dateOnly(sprint.start_date)]);
    rows.push(['Sprint', 'End Date', dateOnly(sprint.end_date)]);
    rows.push(['Delivery', 'Planned Points', num(sprint.planned_points)]);
    rows.push(['Delivery', 'Completed Points', num(sprint.completed_points)]);
    rows.push(['Delivery', 'Completion %', toPct(sprint.completed_points, sprint.planned_points)]);
    rows.push(['Burnout', 'Over Capacity Contributors', num(burnoutResp.rows[0]?.over_capacity_count)]);

    for (const item of tasksResp.rows || []) {
      rows.push(['Tasks', `${item.status} Count`, num(item.total)]);
      rows.push(['Tasks', `${item.status} Points`, num(item.points)]);
    }
    for (const item of alertsResp.rows || []) {
      rows.push(['Alerts', `${item.severity} Count`, num(item.total)]);
    }

    const csv = toCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sprint-report-${sprintId}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listReports,
  getSprintReport,
  exportSprintReportCsv,
};
