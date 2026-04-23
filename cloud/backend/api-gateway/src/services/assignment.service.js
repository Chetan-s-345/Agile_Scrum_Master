function requireOrgDb(req) {
  const pool = req.orgDb;
  if (!pool) throw Object.assign(new Error('Org DB not attached'), { statusCode: 500 });
  return pool;
}

function toIsoDate(dateLike) {
  return new Date(dateLike).toISOString().slice(0, 10);
}

/**
 * Computes percentage overlap between required task tags and developer stack.
 *
 * We keep this normalized to 0-100 so downstream ranking can combine signals
 * without leaking implementation-specific weighting into API responses.
 */
function computeTechMatchScore(techTags, devTechStack) {
  const required = Array.isArray(techTags) ? techTags.map(String) : [];
  if (!required.length) return 0;
  const stack = new Set((Array.isArray(devTechStack) ? devTechStack : []).map((t) => String(t).toLowerCase()));
  const matched = required.filter((t) => stack.has(String(t).toLowerCase())).length;
  return Math.round((matched / required.length) * 10000) / 100;
}

/**
 * Estimates remaining sprint capacity after assigning a task.
 *
 * Returning 0 for invalid capacity avoids giving accidental preference to
 * malformed developer records and keeps ranking deterministic.
 */
function computeWorkloadScore(currentLoad, maxCapacity, storyPoints) {
  const max = Number(maxCapacity || 0);
  if (max <= 0) return 0;
  const remaining = Math.max(0, max - Number(currentLoad || 0) - Number(storyPoints || 0));
  return Math.round((remaining / max) * 10000) / 100;
}

function normalizePriority(p) {
  const v = String(p || '').toLowerCase();
  if (v === 'critical') return 4;
  if (v === 'high') return 3;
  if (v === 'medium') return 2;
  if (v === 'low') return 1;
  return 0;
}

const { queueJiraTaskSync } = require('./jiraSync.service');

class AssignmentService {
  async getSprintDates(orgPool, sprintId) {
    const resp = await orgPool.query('SELECT start_date, end_date FROM sprints WHERE id = $1', [String(sprintId)]);
    const row = resp.rows[0];
    if (!row) throw Object.assign(new Error('Sprint not found'), { statusCode: 404 });
    return { startDate: toIsoDate(row.start_date), endDate: toIsoDate(row.end_date) };
  }

  async getCandidates(orgPool, { techTags, storyPoints, sprintId, excludeDeveloperId }) {
    const sprint = await this.getSprintDates(orgPool, sprintId);

    const candidateResp = await orgPool.query(
      `SELECT
         dp.id,
         dp.tech_stack,
         dp.merit_score,
         dp.assignment_weight,
         dp.current_sprint_load,
         dp.max_sprint_capacity,
         dp.availability_status,
         tm.full_name
       FROM developer_profiles dp
       JOIN team_members tm ON tm.id = dp.member_id
       WHERE tm.is_active = TRUE
         AND dp.availability_status = 'available'
         ${excludeDeveloperId ? 'AND dp.id <> $1' : ''}
       ORDER BY (dp.merit_score * dp.assignment_weight) DESC`,
      excludeDeveloperId ? [String(excludeDeveloperId)] : []
    );

    const baseRows = candidateResp.rows || [];
    const totalCandidates = baseRows.length;

    const hasTechRequirements = Array.isArray(techTags) && techTags.length > 0;
    const filteredByTech = hasTechRequirements
      ? baseRows.filter((dev) => computeTechMatchScore(techTags, dev.tech_stack) <= 0).length
      : 0;

    // Availability filter: capacity + leave overlap.
    // Use one leave-range query to avoid N+1 round-trips under load.
    const leaveResp = await orgPool.query(
      `SELECT DISTINCT developer_id
       FROM developer_availability
       WHERE start_date <= $2::date
         AND end_date >= $1::date`,
      [sprint.startDate, sprint.endDate]
    );
    const unavailableIds = new Set((leaveResp.rows || []).map((row) => String(row.developer_id)));

    const remaining = [];
    let filteredByAvailability = 0;
    for (const dev of baseRows) {
      const currentLoad = Number(dev.current_sprint_load || 0);
      const maxCap = Number(dev.max_sprint_capacity || 0);
      if (currentLoad + Number(storyPoints) > maxCap || unavailableIds.has(String(dev.id))) {
        filteredByAvailability++;
        continue;
      }
      remaining.push(dev);
    }

    // Ranking score
    const ranked = remaining
      .map((dev) => {
        const techMatchScore = computeTechMatchScore(techTags, dev.tech_stack);
        const workloadScore = computeWorkloadScore(dev.current_sprint_load, dev.max_sprint_capacity, storyPoints);
        const availabilityScore = 100;
        const meritComponent = Number(dev.merit_score) * Number(dev.assignment_weight);
        const finalRankingScore =
          Math.round((meritComponent * 0.6 + techMatchScore * 0.25 + workloadScore * 0.15) * 100) / 100;
        return {
          developer: {
            id: dev.id,
            name: dev.full_name,
            meritScore: Number(dev.merit_score),
            assignmentWeight: Number(dev.assignment_weight),
            techStack: dev.tech_stack || [],
            currentLoad: Number(dev.current_sprint_load || 0),
            maxCapacity: Number(dev.max_sprint_capacity || 0),
          },
          scores: { techMatchScore, availabilityScore, workloadScore, finalRankingScore },
        };
      })
      .sort((a, b) => b.scores.finalRankingScore - a.scores.finalRankingScore);

    return {
      sprint,
      totalCandidates,
      filteredByTech,
      filteredByAvailability,
      ranked,
    };
  }

  pickWinner(ranked) {
    if (!ranked.length) return null;

    // Restrict tie-break evaluation to top-ranked candidates so we preserve
    // merit-based ordering while still preferring the least-loaded assignee.
    const top3 = ranked.slice(0, 3);
    let best = top3[0];
    let bestRemaining = -Infinity;

    for (const item of top3) {
      const remainingCapacity = item.developer.maxCapacity - item.developer.currentLoad;
      if (remainingCapacity > bestRemaining) {
        bestRemaining = remainingCapacity;
        best = item;
      }
    }

    return best;
  }

  async assign(req, { taskId, sprintId, techTags, storyPoints, priority }, { excludeDeveloperId } = {}) {
    const orgPool = requireOrgDb(req);

    const { totalCandidates, filteredByTech, filteredByAvailability, ranked } = await this.getCandidates(orgPool, {
      techTags,
      storyPoints,
      sprintId,
      excludeDeveloperId,
    });

    if (!ranked.length) {
      const reasonCode = totalCandidates === 0 ? 'no_developers' : 'all_at_capacity';
      const suggestion = totalCandidates === 0 ? 'Add developer profiles to this organization.' : 'Reduce story points or increase sprint capacity.';

      await orgPool.query(
        `INSERT INTO assignment_failures (task_id, reason_code, required_tech_tags, available_devs, matched_tech_devs, suggestion)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [String(taskId), reasonCode, techTags || [], totalCandidates, totalCandidates, suggestion]
      );

      return { assigned: false, reason: reasonCode, suggestion };
    }

    const winner = this.pickWinner(ranked);
    if (!winner) {
      return { assigned: false, reason: 'no_developers', suggestion: 'No candidates found.' };
    }

    const reason = `Selected from top-ranked candidates by remaining capacity. Priority: ${priority || 'n/a'}.`;

    await orgPool.query('BEGIN');
    try {
      // Assign task
      await orgPool.query(
        `UPDATE tasks
         SET assignee_id = $1, assigned_by = 'ai', assigned_at = NOW(), story_points = $4, tech_tags = $5, priority = COALESCE($6, priority), updated_at = NOW()
         WHERE id = $2 AND sprint_id = $3`,
        [
          String(winner.developer.id),
          String(taskId),
          String(sprintId),
          Number(storyPoints),
          techTags || [],
          priority || null,
        ]
      );

      // Update workload
      await orgPool.query(
        `UPDATE developer_profiles
         SET current_sprint_load = current_sprint_load + $2,
             updated_at = NOW()
         WHERE id = $1`,
        [String(winner.developer.id), Number(storyPoints)]
      );

      await orgPool.query(
        `INSERT INTO assignment_log (
          task_id, developer_id, assigned_by,
          merit_score_snapshot, tech_match_score, availability_score, workload_score, final_ranking_score,
          total_candidates, filtered_by_tech, filtered_by_availability, assignment_reason
        ) VALUES ($1,$2,'ai',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          String(taskId),
          String(winner.developer.id),
          Number(winner.developer.meritScore),
          Number(winner.scores.techMatchScore),
          Number(winner.scores.availabilityScore),
          Number(winner.scores.workloadScore),
          Number(winner.scores.finalRankingScore),
          Number(totalCandidates),
          Number(filteredByTech),
          Number(filteredByAvailability),
          reason,
        ]
      );

      await orgPool.query('COMMIT');
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }

    // Best-effort Jira sync trigger (if integration active)
    await queueJiraTaskSync(req, {
      taskId: String(taskId),
      action: 'assignee_update',
      sprintId: String(sprintId),
    });

    return {
      assigned: true,
      developer: winner.developer,
      scores: winner.scores,
      reason,
    };
  }

  async assignToDeveloper(req, { taskId, sprintId, developerId, reason }) {
    const orgPool = requireOrgDb(req);

    const taskResp = await orgPool.query(
      `SELECT id, sprint_id, story_points, assignee_id
       FROM tasks
       WHERE id = $1 AND sprint_id = $2`,
      [String(taskId), String(sprintId)]
    );
    const task = taskResp.rows[0];
    if (!task) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

    const points = Number(task.story_points || 0);
    const oldAssignee = task.assignee_id ? String(task.assignee_id) : null;
    const newAssignee = String(developerId);

    const assignmentReason = reason || 'Explicit assignment from agentic sprint plan.';

    await orgPool.query('BEGIN');
    try {
      await orgPool.query(
        `UPDATE tasks
         SET assignee_id = $1, assigned_by = 'ai_agentic', assigned_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND sprint_id = $3`,
        [newAssignee, String(taskId), String(sprintId)]
      );

      if (oldAssignee && oldAssignee !== newAssignee) {
        await orgPool.query(
          `UPDATE developer_profiles
           SET current_sprint_load = GREATEST(0, current_sprint_load - $2), updated_at = NOW()
           WHERE id = $1`,
          [oldAssignee, points]
        );
      }

      if (!oldAssignee || oldAssignee !== newAssignee) {
        await orgPool.query(
          `UPDATE developer_profiles
           SET current_sprint_load = current_sprint_load + $2, updated_at = NOW()
           WHERE id = $1`,
          [newAssignee, points]
        );
      }

      await orgPool.query(
        `INSERT INTO assignment_log (
          task_id, developer_id, assigned_by,
          total_candidates, filtered_by_tech, filtered_by_availability,
          assignment_reason
        ) VALUES ($1,$2,'ai_agentic',$3,$4,$5,$6)`,
        [String(taskId), newAssignee, 0, 0, 0, assignmentReason]
      );

      await orgPool.query('COMMIT');
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }

    // Best-effort Jira sync trigger (if integration active)
    await queueJiraTaskSync(req, {
      taskId: String(taskId),
      action: 'assignee_update',
      sprintId: String(sprintId),
    });

    return { assigned: true, taskId: String(taskId), developerId: newAssignee, reason: assignmentReason };
  }

  async suggest(req, taskId) {
    const orgPool = requireOrgDb(req);

    const taskResp = await orgPool.query(
      `SELECT id, sprint_id, story_points, tech_tags, assignee_id
       FROM tasks
       WHERE id = $1`,
      [String(taskId)]
    );
    const task = taskResp.rows[0];
    if (!task) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

    const { ranked } = await this.getCandidates(orgPool, {
      techTags: task.tech_tags || [],
      storyPoints: Number(task.story_points || 0),
      sprintId: task.sprint_id,
      excludeDeveloperId: task.assignee_id || null,
    });

    return ranked.map((r) => ({
      developer: r.developer.name,
      developerId: r.developer.id,
      meritScore: r.developer.meritScore,
      techMatchPct: r.scores.techMatchScore,
      currentLoad: r.developer.currentLoad,
      available: true,
      score: r.scores.finalRankingScore,
    }));
  }

  async failures(req) {
    const orgPool = requireOrgDb(req);
    const resp = await orgPool.query(
      `SELECT id, task_id, failed_at, reason_code, required_tech_tags, suggestion, resolved
       FROM assignment_failures
       WHERE resolved = FALSE
       ORDER BY failed_at DESC
       LIMIT 200`
    );

    const grouped = {};
    for (const row of resp.rows) {
      const code = row.reason_code;
      if (!grouped[code]) grouped[code] = { reasonCode: code, count: 0, suggestion: row.suggestion || null, failures: [] };
      grouped[code].count++;
      grouped[code].failures.push(row);
    }

    return Object.values(grouped);
  }

  async log(req, { developerId, sprintId, from, to, limit = 50, offset = 0 }) {
    const orgPool = requireOrgDb(req);

    const where = [];
    const params = [];
    const push = (expr, val) => {
      params.push(val);
      where.push(expr.replace('?', `$${params.length}`));
    };

    if (developerId) push('al.developer_id = ?', String(developerId));
    if (sprintId) push('t.sprint_id = ?', String(sprintId));
    if (from) push('al.assigned_at >= ?::timestamptz', String(from));
    if (to) push('al.assigned_at <= ?::timestamptz', String(to));

    params.push(Number(limit));
    const limitIdx = params.length;
    params.push(Number(offset));
    const offsetIdx = params.length;

    const resp = await orgPool.query(
      `SELECT
         al.id,
         al.assigned_at,
         al.assigned_by,
         al.merit_score_snapshot,
         al.tech_match_score,
         al.availability_score,
         al.workload_score,
         al.final_ranking_score,
         al.assignment_reason,
         t.id AS task_id,
         t.title AS task_title,
         t.sprint_id,
         dp.id AS developer_id,
         tm.full_name AS developer_name
       FROM assignment_log al
       JOIN tasks t ON t.id = al.task_id
       JOIN developer_profiles dp ON dp.id = al.developer_id
       JOIN team_members tm ON tm.id = dp.member_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY al.assigned_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    return { items: resp.rows, limit: Number(limit), offset: Number(offset) };
  }

  async assignBulk(req, tasks) {
    const ordered = [...tasks].sort((a, b) => normalizePriority(b.priority) - normalizePriority(a.priority));
    const results = [];

    for (const t of ordered) {
      try {
        const out = await this.assign(req, t);
        results.push({ taskId: t.taskId, assigned: Boolean(out.assigned), developer: out.developer || null, reason: out.reason || null, suggestion: out.suggestion || null });
      } catch (e) {
        results.push({ taskId: t.taskId, assigned: false, reason: e?.message || 'Failed', suggestion: null });
      }
    }

    return { results };
  }

  async reassign(req, taskId, reason) {
    const orgPool = requireOrgDb(req);

    const taskResp = await orgPool.query(
      `SELECT id, sprint_id, story_points, tech_tags, assignee_id
       FROM tasks
       WHERE id = $1`,
      [String(taskId)]
    );
    const task = taskResp.rows[0];
    if (!task) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

    const oldAssignee = task.assignee_id;

    const out = await this.assign(
      req,
      {
        taskId: String(task.id),
        sprintId: String(task.sprint_id),
        techTags: task.tech_tags || [],
        storyPoints: Number(task.story_points || 0),
        priority: undefined,
      },
      { excludeDeveloperId: oldAssignee }
    );

    if (out.assigned && oldAssignee) {
      // Decrement old assignee load best-effort
      await orgPool.query(
        `UPDATE developer_profiles
         SET current_sprint_load = GREATEST(0, current_sprint_load - $2), updated_at = NOW()
         WHERE id = $1`,
        [String(oldAssignee), Number(task.story_points || 0)]
      );

      // Mark previous assignment log as updated
      await orgPool.query(
        `UPDATE assignment_log
         SET updated_at = NOW(), assignment_reason = COALESCE(assignment_reason,'') || $2
         WHERE task_id = $1`,
        [String(taskId), `\nReassigned: ${reason || 'no reason provided'}`]
      );
    }

    return out;
  }
}

const assignmentService = new AssignmentService();

module.exports = { assignmentService };
