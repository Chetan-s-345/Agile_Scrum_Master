const { assignmentService } = require('./assignment.service');
const { getQueues } = require('./queue.service');
const { queueJiraTaskSync } = require('./jiraSync.service');
const { logger } = require('../middleware/logger');

function requireOrgDb(req) {
  const pool = req.orgDb;
  if (!pool) throw Object.assign(new Error('Org DB not attached'), { statusCode: 500 });
  return pool;
}

function parseDateToIso(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
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

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function getActorMemberId(orgPool, userId) {
  const resp = await orgPool.query('SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1', [String(userId)]);
  return resp.rows[0]?.id || null;
}

async function audit(orgPool, { actorMemberId, action, resourceType, resourceId, oldValue, newValue, ipAddress, userAgent }) {
  await orgPool.query(
    `INSERT INTO org_audit_log (actor_member_id, action, resource_type, resource_id, old_value, new_value, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      actorMemberId || null,
      String(action),
      resourceType || null,
      resourceId || null,
      oldValue || null,
      newValue || null,
      ipAddress || null,
      userAgent || null,
    ]
  );
}

function priorityScore(priority) {
  const p = String(priority || '').toLowerCase();
  if (p === 'critical') return 100;
  if (p === 'high') return 75;
  if (p === 'medium') return 50;
  if (p === 'low') return 25;
  return 0;
}

class SprintService {
  async getTeamBreakdown(orgPool) {
    const capResp = await orgPool.query(
      `SELECT
         dp.id AS developer_id,
         tm.full_name,
         dp.max_sprint_capacity,
         dp.current_sprint_load,
         dp.availability_status,
         CASE
           WHEN dp.availability_status = 'available'
             THEN GREATEST(0, dp.max_sprint_capacity - dp.current_sprint_load)::int
           ELSE 0
         END AS available_capacity
       FROM developer_profiles dp
       JOIN team_members tm ON tm.id = dp.member_id
       WHERE tm.is_active = TRUE
       ORDER BY tm.full_name ASC`
    );

    const breakdown = capResp.rows.map((r) => ({
      developerId: r.developer_id,
      name: r.full_name,
      availabilityStatus: r.availability_status,
      maxCapacity: Number(r.max_sprint_capacity || 0),
      currentLoad: Number(r.current_sprint_load || 0),
      availableCapacity: Number(r.available_capacity || 0),
    }));

    const totalCapacityPts = breakdown.reduce((sum, d) => sum + Number(d.availableCapacity || 0), 0);

    return { breakdown, totalCapacityPts };
  }

  async list(req, { projectId, status }) {
    const orgPool = requireOrgDb(req);

    const where = [];
    const params = [];
    const push = (expr, val) => {
      params.push(val);
      where.push(expr.replace('?', `$${params.length}`));
    };

    if (projectId) push('s.project_id = ?', String(projectId));
    if (status) push('s.status = ?', String(status));

    const resp = await orgPool.query(
      `SELECT
         s.id,
         s.project_id,
         s.name,
         s.start_date,
         s.end_date,
         s.planned_points,
         s.completed_points,
         COALESCE(s.actual_velocity, s.predicted_velocity, 0) AS velocity,
         COALESCE(s.ai_risk_score, 0) AS risk_score,
         CASE WHEN COALESCE(s.planned_points, 0) = 0 THEN 0
              ELSE ROUND((COALESCE(s.completed_points, 0)::DECIMAL / NULLIF(s.planned_points, 0)) * 100, 2)
         END AS completion_pct,
         GREATEST(0, (s.end_date - CURRENT_DATE))::int AS days_remaining
       FROM sprints s
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.start_date DESC`,
      params
    );

    return resp.rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      plannedPoints: Number(r.planned_points || 0),
      completedPoints: Number(r.completed_points || 0),
      velocity: Number(r.velocity || 0),
      riskScore: Number(r.risk_score || 0),
      completionPct: Number(r.completion_pct || 0),
      daysRemaining: Number(r.days_remaining || 0),
    }));
  }

  async create(req, payload, context) {
    const orgPool = requireOrgDb(req);

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const startIso = parseDateToIso(payload.startDate);
    const endIso = parseDateToIso(payload.endDate);
    if (!startIso || !endIso) throw Object.assign(new Error('Invalid startDate/endDate'), { statusCode: 400 });
    if (endIso < startIso) throw Object.assign(new Error('endDate must be after startDate'), { statusCode: 400 });

    const numResp = await orgPool.query('SELECT COALESCE(MAX(sprint_number), 0)::int + 1 AS next FROM sprints WHERE project_id = $1', [String(payload.projectId)]);
    const sprintNumber = numResp.rows[0]?.next || 1;

    const { breakdown, totalCapacityPts } = await this.getTeamBreakdown(orgPool);

    const insertResp = await orgPool.query(
      `INSERT INTO sprints (project_id, name, goal, sprint_number, status, start_date, end_date, total_capacity_pts, created_by)
       VALUES ($1,$2,$3,$4,'planning',$5::date,$6::date,$7,$8)
       RETURNING *`,
      [
        String(payload.projectId),
        String(payload.name),
        payload.goal || null,
        Number(sprintNumber),
        startIso,
        endIso,
        Number(totalCapacityPts),
        actorMemberId,
      ]
    );

    const sprint = insertResp.rows[0];

    await audit(orgPool, {
      actorMemberId,
      action: 'sprint.create',
      resourceType: 'sprint',
      resourceId: String(sprint.id),
      oldValue: null,
      newValue: sprint,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { sprint, teamBreakdown: breakdown };
  }

  async plan(req, sprintId, payload) {
    const orgPool = requireOrgDb(req);

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const sprintResp = await orgPool.query('SELECT * FROM sprints WHERE id = $1', [String(sprintId)]);
    const sprint = sprintResp.rows[0];
    if (!sprint) throw Object.assign(new Error('Sprint not found'), { statusCode: 404 });

    if (String(sprint.project_id) !== String(payload.projectId)) {
      throw Object.assign(new Error('projectId does not match sprint'), { statusCode: 400 });
    }

    const { breakdown } = await this.getTeamBreakdown(orgPool);
    const capacity = Math.max(0, Number(sprint.total_capacity_pts || 0));
    const maxPoints = payload.maxPoints ? Math.max(1, Number(payload.maxPoints)) : null;
    const targetCapacity = maxPoints ? Math.min(capacity, maxPoints) : capacity;

    const backlogResp = await orgPool.query(
      `SELECT
         id,
         title,
         description,
         type,
         priority,
         status,
         story_points,
         ai_estimated_points,
         business_value,
         tech_tags,
         acceptance_criteria
       FROM backlog_items
       WHERE project_id = $1
         AND status = 'ready'
         AND sprint_id IS NULL
       ORDER BY business_value DESC, created_at ASC`,
      [String(payload.projectId)]
    );

    const scored = backlogResp.rows.map((b) => {
      const pri = priorityScore(b.priority);
      const business = Number(b.business_value || 0);
      const dependency = 0;
      const score = pri * 0.5 + business * 0.3 + dependency * 0.2;
      const points = b.story_points === null || b.story_points === undefined ? Number(b.ai_estimated_points || 0) : Number(b.story_points || 0);
      return { ...b, score, points };
    });

    scored.sort((a, b) => b.score - a.score);

    const selected = [];
    let totalPoints = 0;
    for (const item of scored) {
      const pts = Number(item.points || 0);
      if (pts > 0 && totalPoints + pts > targetCapacity) continue;
      selected.push(item);
      totalPoints += pts;
      if (totalPoints >= targetCapacity) break;
    }

    await orgPool.query('BEGIN');
    try {
      if (selected.length) {
        const ids = selected.map((s) => String(s.id));
        await orgPool.query(
          `UPDATE backlog_items
           SET sprint_id = $1, status = 'in_sprint', updated_at = NOW()
           WHERE id = ANY($2::uuid[])`,
          [String(sprintId), ids]
        );

        const createdTasks = [];
        for (const item of selected) {
          const taskResp = await orgPool.query(
            `INSERT INTO tasks (
               backlog_item_id, sprint_id, project_id,
               title, description, type, priority, story_points, tech_tags, acceptance_criteria,
               created_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id, sprint_id, project_id, title, story_points, tech_tags, priority`,
            [
              String(item.id),
              String(sprintId),
              String(payload.projectId),
              String(item.title),
              item.description || null,
              item.type || 'story',
              item.priority || 'medium',
              Number(item.points || 0),
              item.tech_tags || [],
              item.acceptance_criteria || null,
              actorMemberId,
            ]
          );
          createdTasks.push(taskResp.rows[0]);
        }

        // Bulk auto-assignment
        const assignPayload = createdTasks.map((t) => ({
          taskId: t.id,
          sprintId: t.sprint_id,
          techTags: t.tech_tags || [],
          storyPoints: Number(t.story_points || 0),
          priority: t.priority,
        }));

        const bulk = assignPayload.length ? await assignmentService.assignBulk(req, assignPayload) : { results: [] };

        await orgPool.query(
          `UPDATE sprints
           SET planned_points = $2, status = 'planning', updated_at = NOW()
           WHERE id = $1`,
          [String(sprintId), Number(totalPoints)]
        );

        await orgPool.query('COMMIT');

        // Best-effort Jira sync trigger for newly created tasks (if integration active)
        for (const t of createdTasks) {
          // eslint-disable-next-line no-await-in-loop
          await queueJiraTaskSync(req, {
            taskId: String(t.id),
            action: 'create',
            projectId: String(t.project_id),
            sprintId: String(t.sprint_id),
          });
        }

        return {
          sprintId: String(sprintId),
          selectedTasks: createdTasks,
          totalPoints,
          capacityUsed: targetCapacity > 0 ? Math.round((totalPoints / targetCapacity) * 10000) / 100 : 0,
          teamBreakdown: breakdown,
          assignment: bulk,
        };
      }

      await orgPool.query(
        `UPDATE sprints
         SET planned_points = $2, status = 'planning', updated_at = NOW()
         WHERE id = $1`,
        [String(sprintId), 0]
      );

      await orgPool.query('COMMIT');

      return {
        sprintId: String(sprintId),
        selectedTasks: [],
        totalPoints: 0,
        capacityUsed: 0,
        teamBreakdown: breakdown,
        assignment: { results: [] },
      };
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }
  }

  async start(req, sprintId, context) {
    const orgPool = requireOrgDb(req);

    const sprintResp = await orgPool.query('SELECT * FROM sprints WHERE id = $1', [String(sprintId)]);
    const sprint = sprintResp.rows[0];
    if (!sprint) throw Object.assign(new Error('Sprint not found'), { statusCode: 404 });
    if (String(sprint.status) !== 'planning') {
      throw Object.assign(new Error('Sprint must be in planning status to start'), { statusCode: 400 });
    }

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);

    await orgPool.query('BEGIN');
    try {
      const updatedResp = await orgPool.query(
        `UPDATE sprints SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [String(sprintId)]
      );

      const updated = updatedResp.rows[0];

      const planned = Number(updated.planned_points || 0);
      const startIso = String(updated.start_date);
      const endIso = String(updated.end_date);
      const sprintDays = daysBetweenInclusive(startIso, endIso);
      const todayIso = new Date().toISOString().slice(0, 10);

      const dayNumber = clamp(daysBetweenInclusive(startIso, todayIso), 1, sprintDays);
      const idealRemaining = planned - (planned / sprintDays) * dayNumber;
      const completedResp = await orgPool.query(
        `SELECT COALESCE(SUM(story_points), 0)::int AS done_points
         FROM tasks WHERE sprint_id = $1 AND status = 'done'`,
        [String(sprintId)]
      );
      const donePoints = Number(completedResp.rows[0]?.done_points || 0);
      const actualRemaining = planned - donePoints;

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
      const c = countsResp.rows[0] || {};

      await orgPool.query(
        `INSERT INTO sprint_progress_snapshots (
           sprint_id, snapshot_date, day_number,
           ideal_points_remaining, actual_points_remaining, points_completed_today,
           current_velocity, required_velocity, velocity_gap_pct,
           tasks_total, tasks_done, tasks_in_progress, tasks_blocked
         ) VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (sprint_id, snapshot_date) DO NOTHING`,
        [
          String(sprintId),
          todayIso,
          Number(dayNumber),
          Number(idealRemaining),
          Number(actualRemaining),
          0,
          0,
          0,
          0,
          Number(c.tasks_total || 0),
          Number(c.tasks_done || 0),
          Number(c.tasks_in_progress || 0),
          Number(c.tasks_blocked || 0),
        ]
      );

      await audit(orgPool, {
        actorMemberId,
        action: 'sprint.start',
        resourceType: 'sprint',
        resourceId: String(sprintId),
        oldValue: sprint,
        newValue: updated,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      await orgPool.query('COMMIT');
      return updated;
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }
  }

  async complete(req, sprintId, context) {
    const orgPool = requireOrgDb(req);

    const sprintResp = await orgPool.query('SELECT * FROM sprints WHERE id = $1', [String(sprintId)]);
    const sprint = sprintResp.rows[0];
    if (!sprint) throw Object.assign(new Error('Sprint not found'), { statusCode: 404 });

    const startIso = String(sprint.start_date);
    const endIso = String(sprint.end_date);
    const sprintDays = daysBetweenInclusive(startIso, endIso);

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);

    await orgPool.query('BEGIN');
    let updated = null;
    try {
      const doneResp = await orgPool.query(
        `SELECT COALESCE(SUM(story_points), 0)::int AS done_points
         FROM tasks
         WHERE sprint_id = $1 AND status = 'done'`,
        [String(sprintId)]
      );
      const donePoints = Number(doneResp.rows[0]?.done_points || 0);
      const velocity = sprintDays > 0 ? Math.round((donePoints / sprintDays) * 100) / 100 : 0;

      const updResp = await orgPool.query(
        `UPDATE sprints
         SET status = 'completed',
             completed_points = $2,
             actual_velocity = $3,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [String(sprintId), donePoints, velocity]
      );
      updated = updResp.rows[0];

      // Reset sprint load for sprint members (developers assigned tasks in this sprint)
      const devsResp = await orgPool.query(
        `SELECT DISTINCT assignee_id AS developer_id
         FROM tasks
         WHERE sprint_id = $1 AND assignee_id IS NOT NULL`,
        [String(sprintId)]
      );
      const devIds = devsResp.rows.map((r) => r.developer_id).filter(Boolean);

      if (devIds.length) {
        await orgPool.query(
          `UPDATE developer_profiles
           SET current_sprint_load = 0, updated_at = NOW()
           WHERE id = ANY($1::uuid[])`,
          [devIds]
        );

        for (const devId of devIds) {
          await orgPool.query('SELECT calculate_merit_score($1, $2)', [String(devId), String(sprintId)]);
          await orgPool.query('SELECT check_burnout_risk($1)', [String(devId)]);
        }
      }

      await audit(orgPool, {
        actorMemberId,
        action: 'sprint.complete',
        resourceType: 'sprint',
        resourceId: String(sprintId),
        oldValue: sprint,
        newValue: updated,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      await orgPool.query('COMMIT');

      // Best-effort: queue report generation
      let reportJobQueued = false;
      try {
        const queues = getQueues();
        await queues.reportGeneration.add(
          'generate-sprint-report',
          { orgId: req.user?.orgId || null, sprintId: String(sprintId) },
          { removeOnComplete: true, removeOnFail: 100 }
        );
        reportJobQueued = true;
      } catch (e) {
        logger.warn({ err: e }, 'Failed to queue report-generation job');
      }

      return {
        sprint: updated,
        reportJobQueued,
      };
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }
  }

  async archive(req, sprintId, context) {
    const orgPool = requireOrgDb(req);

    const beforeResp = await orgPool.query('SELECT * FROM sprints WHERE id = $1', [String(sprintId)]);
    const before = beforeResp.rows[0];
    if (!before) throw Object.assign(new Error('Sprint not found'), { statusCode: 404 });

    const afterResp = await orgPool.query(
      `UPDATE sprints
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [String(sprintId)]
    );
    const after = afterResp.rows[0];

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    await audit(orgPool, {
      actorMemberId,
      action: 'sprint.archive',
      resourceType: 'sprint',
      resourceId: String(sprintId),
      oldValue: before,
      newValue: after,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { ok: true, sprint: after };
  }

  async remove(req, sprintId, context) {
    const orgPool = requireOrgDb(req);

    const beforeResp = await orgPool.query('SELECT * FROM sprints WHERE id = $1', [String(sprintId)]);
    const before = beforeResp.rows[0];
    if (!before) throw Object.assign(new Error('Sprint not found'), { statusCode: 404 });

    await orgPool.query('BEGIN');
    try {
      // Detach backlog references first; tasks are deleted via ON DELETE CASCADE.
      await orgPool.query('UPDATE backlog_items SET sprint_id = NULL, status = CASE WHEN status = \'in_sprint\' THEN \'ready\' ELSE status END WHERE sprint_id = $1', [
        String(sprintId),
      ]);

      await orgPool.query('DELETE FROM sprints WHERE id = $1', [String(sprintId)]);

      const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
      await audit(orgPool, {
        actorMemberId,
        action: 'sprint.delete',
        resourceType: 'sprint',
        resourceId: String(sprintId),
        oldValue: before,
        newValue: null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      await orgPool.query('COMMIT');
      return { ok: true, deleted: true };
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }
  }

  async get(req, sprintId) {
    const orgPool = requireOrgDb(req);

    const sprintResp = await orgPool.query('SELECT * FROM sprints WHERE id = $1', [String(sprintId)]);
    const sprint = sprintResp.rows[0];
    if (!sprint) throw Object.assign(new Error('Sprint not found'), { statusCode: 404 });

    const tasksResp = await orgPool.query(
      `SELECT
         t.id,
         t.title,
         t.status,
         t.story_points,
         t.priority,
         t.tech_tags,
         t.ai_risk_score,
         t.assignee_id,
         tm.full_name AS assignee_name,
         tm.avatar_url AS assignee_avatar
       FROM tasks t
       LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
       LEFT JOIN team_members tm ON tm.id = dp.member_id
       WHERE t.sprint_id = $1
       ORDER BY t.created_at ASC`,
      [String(sprintId)]
    );

    const grouped = { todo: [], in_progress: [], in_review: [], blocked: [], done: [], cancelled: [] };
    for (const t of tasksResp.rows) {
      const key = grouped[t.status] ? t.status : 'todo';
      grouped[key].push({
        id: t.id,
        title: t.title,
        status: t.status,
        storyPoints: Number(t.story_points || 0),
        priority: t.priority,
        techTags: t.tech_tags || [],
        aiRiskScore: t.ai_risk_score,
        assignee: t.assignee_id ? { id: t.assignee_id, name: t.assignee_name, avatarUrl: t.assignee_avatar } : null,
      });
    }

    const capacityResp = await orgPool.query(
      `SELECT full_name, primary_role, max_sprint_capacity, current_sprint_load, remaining_capacity, utilization_pct, merit_score, burnout_risk_flag
       FROM v_team_capacity
       ORDER BY remaining_capacity DESC`
    );

    const snapshotResp = await orgPool.query(
      `SELECT *
       FROM sprint_progress_snapshots
       WHERE sprint_id = $1
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [String(sprintId)]
    );

    const alertsResp = await orgPool.query(
      `SELECT id, alert_type, severity, title, message, suggestion, created_at
       FROM delay_alerts
       WHERE sprint_id = $1 AND acknowledged = FALSE
       ORDER BY created_at DESC
       LIMIT 200`,
      [String(sprintId)]
    );

    return {
      sprint,
      tasks: grouped,
      developerCapacity: capacityResp.rows,
      latestProgressSnapshot: snapshotResp.rows[0] || null,
      activeDelayAlerts: alertsResp.rows,
    };
  }

  async burndown(req, sprintId) {
    const orgPool = requireOrgDb(req);

    const resp = await orgPool.query(
      `SELECT day_number, ideal_points_remaining, actual_points_remaining, snapshot_date
       FROM sprint_progress_snapshots
       WHERE sprint_id = $1
       ORDER BY snapshot_date ASC`,
      [String(sprintId)]
    );

    return resp.rows.map((r) => ({
      day: Number(r.day_number),
      idealRemaining: Number(r.ideal_points_remaining || 0),
      actualRemaining: Number(r.actual_points_remaining || 0),
      date: r.snapshot_date,
    }));
  }

  async risk(req, sprintId) {
    const orgPool = requireOrgDb(req);

    const sprintResp = await orgPool.query(
      `SELECT id, planned_points, start_date, end_date
       FROM sprints
       WHERE id = $1`,
      [String(sprintId)]
    );
    const sprint = sprintResp.rows[0];
    if (!sprint) throw Object.assign(new Error('Sprint not found'), { statusCode: 404 });

    const plannedPoints = Number(sprint.planned_points || 0);
    const startIso = String(sprint.start_date);
    const endIso = String(sprint.end_date);

    const todayIso = new Date().toISOString().slice(0, 10);
    const sprintDays = daysBetweenInclusive(startIso, endIso);
    const elapsedDays = clamp(daysBetweenInclusive(startIso, todayIso), 1, sprintDays);
    const remainingDays = clamp(daysBetweenInclusive(todayIso, endIso), 0, sprintDays);

    const doneResp = await orgPool.query(
      `SELECT COALESCE(SUM(story_points), 0)::int AS done_points
       FROM tasks
       WHERE sprint_id = $1 AND status = 'done'`,
      [String(sprintId)]
    );
    const donePoints = Number(doneResp.rows[0]?.done_points || 0);

    const blockedResp = await orgPool.query(
      `SELECT COUNT(*)::int AS blocked
       FROM tasks
       WHERE sprint_id = $1 AND status = 'blocked'`,
      [String(sprintId)]
    );
    const blockedCount = Number(blockedResp.rows[0]?.blocked || 0);

    const currentVelocity = elapsedDays > 0 ? donePoints / elapsedDays : 0;
    const remainingPoints = Math.max(0, plannedPoints - donePoints);
    const requiredVelocity = remainingDays > 0 ? remainingPoints / remainingDays : remainingPoints;

    const velocityGapPct = requiredVelocity > 0 ? ((requiredVelocity - currentVelocity) / requiredVelocity) * 100 : 0;

    const availResp = await orgPool.query(
      `SELECT COUNT(*)::int AS available_devs
       FROM developer_profiles dp
       JOIN team_members tm ON tm.id = dp.member_id
       WHERE tm.is_active = TRUE AND dp.availability_status = 'available'`
    );
    const availableDevs = Number(availResp.rows[0]?.available_devs || 0);

    const factors = [];
    factors.push({ key: 'velocityGapPct', value: Math.round(velocityGapPct * 100) / 100 });
    factors.push({ key: 'blockedTasks', value: blockedCount });
    factors.push({ key: 'availableDevelopers', value: availableDevs });
    factors.push({ key: 'daysRemaining', value: remainingDays });

    const availabilityPenalty = availableDevs === 0 ? 30 : 0;
    const endPenalty = remainingDays <= 1 ? 10 : 0;

    const riskScore = clamp(Math.round((Math.max(0, velocityGapPct) + blockedCount * 5 + availabilityPenalty + endPenalty) * 100) / 100, 0, 100);

    let riskLevel = 'low';
    if (riskScore >= 75) riskLevel = 'critical';
    else if (riskScore >= 50) riskLevel = 'high';
    else if (riskScore >= 20) riskLevel = 'medium';

    const recommendations = [];
    if (blockedCount > 0) recommendations.push('Unblock tasks by resolving dependencies or reassigning blockers.');
    if (velocityGapPct > 20) recommendations.push('Reduce scope or increase capacity to close the velocity gap.');
    if (availableDevs === 0) recommendations.push('No available developers detected; update availability or adjust sprint plan.');

    return { riskScore, riskLevel, factors, recommendations };
  }
}

const sprintService = new SprintService();

module.exports = { sprintService, SprintService };
