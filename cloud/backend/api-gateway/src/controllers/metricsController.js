const { prMetricsService } = require('../services/prMetricsService');
const { sprintService } = require('../services/sprint.service');

function safeText(value) {
  return String(value || '').trim();
}

function parseLimit(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(12, Math.floor(n)));
}

async function resolveSprintId(orgPool, projectId, sprintId) {
  if (sprintId) return sprintId;
  if (!projectId) return null;

  const activeResp = await orgPool.query(
    `SELECT id
     FROM sprints
     WHERE project_id = $1 AND status = 'active'
     ORDER BY start_date DESC
     LIMIT 1`,
    [projectId]
  );
  if (activeResp.rows[0]?.id) return String(activeResp.rows[0].id);

  const latestResp = await orgPool.query(
    `SELECT id
     FROM sprints
     WHERE project_id = $1
     ORDER BY start_date DESC
     LIMIT 1`,
    [projectId]
  );
  return latestResp.rows[0]?.id ? String(latestResp.rows[0].id) : null;
}

async function getPrReviewMetrics(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) {
      return res.status(500).json({ error: 'Org DB not attached', code: 500, detail: 'Org DB not attached' });
    }

    const groupBy = safeText(req.query.groupBy).toLowerCase() || 'reviewer';
    const sprintId = safeText(req.query.sprintId) || null;

    const items = await prMetricsService.getPrReviewMetrics(orgPool, { groupBy, sprintId });
    return res.status(200).json({ groupBy, sprintId, items });
  } catch (err) {
    const code = Number(err?.statusCode || 500);
    if (code >= 400 && code < 500) {
      return res.status(code).json({ error: 'Bad request', code, detail: String(err?.message || 'Bad request') });
    }
    return next(err);
  }
}

async function getBurndownMetrics(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) {
      return res.status(500).json({ error: 'Org DB not attached', code: 500, detail: 'Org DB not attached' });
    }

    const projectId = safeText(req.query.projectId) || null;
    const sprintIdInput = safeText(req.query.sprintId) || null;
    const sprintId = await resolveSprintId(orgPool, projectId, sprintIdInput);
    if (!sprintId) {
      return res.status(400).json({ error: 'Bad request', code: 400, detail: 'sprintId or resolvable projectId is required.' });
    }

    const items = await sprintService.burndown(req, sprintId);
    const latest = items.length ? items[items.length - 1] : null;

    return res.status(200).json({
      sprintId,
      points: items,
      summary: {
        daysTracked: items.length,
        idealRemaining: latest ? Number(latest.idealRemaining || 0) : 0,
        actualRemaining: latest ? Number(latest.actualRemaining || 0) : 0,
      },
    });
  } catch (err) {
    const code = Number(err?.statusCode || 500);
    if (code >= 400 && code < 500) {
      return res.status(code).json({ error: 'Bad request', code, detail: String(err?.message || 'Bad request') });
    }
    return next(err);
  }
}

async function getTeamLoadMetrics(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) {
      return res.status(500).json({ error: 'Org DB not attached', code: 500, detail: 'Org DB not attached' });
    }

    const projectId = safeText(req.query.projectId) || null;
    const sprintIdInput = safeText(req.query.sprintId) || null;
    const sprintId = await resolveSprintId(orgPool, projectId, sprintIdInput);
    if (!sprintId) {
      return res.status(400).json({ error: 'Bad request', code: 400, detail: 'sprintId or resolvable projectId is required.' });
    }

    const resp = await orgPool.query(
      `SELECT
         COALESCE(tm.id::text, 'unassigned') AS member_id,
         COALESCE(tm.full_name, 'Unassigned') AS name,
         COALESCE(dp.max_sprint_capacity, 0)::numeric AS capacity,
         COALESCE(SUM(t.story_points), 0)::numeric AS total_points,
         COALESCE(SUM(t.story_points) FILTER (WHERE t.status = 'todo'), 0)::numeric AS todo_points,
         COALESCE(SUM(t.story_points) FILTER (WHERE t.status = 'in_progress'), 0)::numeric AS in_progress_points,
         COALESCE(SUM(t.story_points) FILTER (WHERE t.status = 'blocked'), 0)::numeric AS blocked_points,
         COALESCE(SUM(t.story_points) FILTER (WHERE t.status = 'done'), 0)::numeric AS done_points
       FROM tasks t
       LEFT JOIN team_members tm ON tm.id = t.assignee_id
       LEFT JOIN developer_profiles dp ON dp.member_id = tm.id
       WHERE t.sprint_id = $1
       GROUP BY COALESCE(tm.id::text, 'unassigned'), COALESCE(tm.full_name, 'Unassigned'), COALESCE(dp.max_sprint_capacity, 0)
       ORDER BY COALESCE(tm.full_name, 'Unassigned') ASC`,
      [sprintId]
    );

    const cells = resp.rows.map((row) => {
      const total = Number(row.total_points || 0);
      return {
        memberId: String(row.member_id || 'unassigned'),
        name: String(row.name || 'Unassigned'),
        capacity: Number(row.capacity || 0),
        totalPoints: total,
        utilizationPct: Number(row.capacity || 0) > 0 ? Math.round((total / Number(row.capacity || 1)) * 100) : 0,
        todoPoints: Number(row.todo_points || 0),
        inProgressPoints: Number(row.in_progress_points || 0),
        blockedPoints: Number(row.blocked_points || 0),
        donePoints: Number(row.done_points || 0),
      };
    });

    return res.status(200).json({ sprintId, cells });
  } catch (err) {
    const code = Number(err?.statusCode || 500);
    if (code >= 400 && code < 500) {
      return res.status(code).json({ error: 'Bad request', code, detail: String(err?.message || 'Bad request') });
    }
    return next(err);
  }
}

async function getVelocityMetrics(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) {
      return res.status(500).json({ error: 'Org DB not attached', code: 500, detail: 'Org DB not attached' });
    }

    const projectId = safeText(req.query.projectId) || null;
    if (!projectId) {
      return res.status(400).json({ error: 'Bad request', code: 400, detail: 'projectId is required.' });
    }
    const limit = parseLimit(req.query.limit, 6);

    const resp = await orgPool.query(
      `SELECT id, name, start_date, end_date, planned_points, completed_points, actual_velocity
       FROM sprints
       WHERE project_id = $1
       ORDER BY start_date DESC
       LIMIT $2`,
      [projectId, limit]
    );

    const ordered = [...resp.rows].reverse();
    const points = ordered.map((row, idx) => {
      const completed = Number(row.completed_points || 0);
      const velocity = Number(row.actual_velocity || completed);
      const rollingSource = ordered.slice(Math.max(0, idx - 2), idx + 1);
      const rollingAvg = rollingSource.length
        ? rollingSource.reduce((acc, cur) => acc + Number(cur.actual_velocity || cur.completed_points || 0), 0) / rollingSource.length
        : velocity;
      return {
        sprintId: String(row.id),
        sprintName: String(row.name || `Sprint ${idx + 1}`),
        startDate: row.start_date,
        endDate: row.end_date,
        plannedPoints: Number(row.planned_points || 0),
        completedPoints: completed,
        velocity,
        rollingAvg: Math.round(rollingAvg * 100) / 100,
      };
    });

    return res.status(200).json({ projectId, limit, points });
  } catch (err) {
    const code = Number(err?.statusCode || 500);
    if (code >= 400 && code < 500) {
      return res.status(code).json({ error: 'Bad request', code, detail: String(err?.message || 'Bad request') });
    }
    return next(err);
  }
}

async function getRiskScoreMetrics(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) {
      return res.status(500).json({ error: 'Org DB not attached', code: 500, detail: 'Org DB not attached' });
    }

    const projectId = safeText(req.query.projectId) || null;
    const sprintIdInput = safeText(req.query.sprintId) || null;
    const sprintId = await resolveSprintId(orgPool, projectId, sprintIdInput);
    if (!sprintId) {
      return res.status(400).json({ error: 'Bad request', code: 400, detail: 'sprintId or resolvable projectId is required.' });
    }

    const risk = await sprintService.risk(req, sprintId);
    const normalizedFactors = Array.isArray(risk.factors)
      ? risk.factors.map((f) => ({
          key: String(f.key || ''),
          value: Number(f.value || 0),
          impact: Number(f.key === 'blockedTasks' ? Number(f.value || 0) * 5 : f.value || 0),
        }))
      : [];

    const topFactors = [...normalizedFactors]
      .sort((a, b) => b.impact - a.impact)
      .slice(0, 3)
      .map((f) => ({
        key: f.key,
        value: f.value,
        impact: Math.round(f.impact * 100) / 100,
      }));

    return res.status(200).json({
      sprintId,
      riskScore: Number(risk.riskScore || 0),
      riskLevel: safeText(risk.riskLevel) || 'low',
      topFactors,
      recommendations: Array.isArray(risk.recommendations) ? risk.recommendations : [],
    });
  } catch (err) {
    const code = Number(err?.statusCode || 500);
    if (code >= 400 && code < 500) {
      return res.status(code).json({ error: 'Bad request', code, detail: String(err?.message || 'Bad request') });
    }
    return next(err);
  }
}

module.exports = {
  getPrReviewMetrics,
  getBurndownMetrics,
  getTeamLoadMetrics,
  getVelocityMetrics,
  getRiskScoreMetrics,
};
