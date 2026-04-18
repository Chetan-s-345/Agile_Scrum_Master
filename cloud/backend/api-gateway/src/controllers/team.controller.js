const {
  uuidSchema,
  createTeamSchema,
  addTeamMemberSchema,
  createJoinRequestSchema,
  reviewJoinRequestSchema,
  updateScoreSchema,
} = require('../validators/team.schemas');
const { teamService } = require('../services/team.service');

function badRequest(res, message, details) {
  return res.status(400).json({ error: message, code: 400, detail: message, details });
}

function apiError(res, code, error, detail) {
  return res.status(code).json({ error, code, detail });
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeText(value) {
  return String(value || '').trim();
}

function resolveLoadLevel(loadPct) {
  if (loadPct > 95) return 'critical';
  if (loadPct > 80) return 'warning';
  return 'normal';
}

function buildMoveReason(task, fromDev, toDev) {
  const title = safeText(task.title) || 'Task';
  return `Move ${title} from ${safeText(fromDev?.developer_name) || 'overloaded developer'} to ${safeText(toDev?.developer_name) || 'available developer'} to reduce load imbalance.`;
}

async function resolveActiveSprintId(orgDb, projectId) {
  const activeResp = await orgDb.query(
    `SELECT id
     FROM sprints
     WHERE project_id = $1
       AND status = 'active'
     ORDER BY start_date DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [projectId]
  );
  if (activeResp.rows[0]?.id) return String(activeResp.rows[0].id);

  const latestResp = await orgDb.query(
    `SELECT id
     FROM sprints
     WHERE project_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [projectId]
  );
  return latestResp.rows[0]?.id ? String(latestResp.rows[0].id) : '';
}

async function getIntelligence(req, res, next) {
  try {
    const projectId = safeText(req.query.projectId);
    if (!projectId) return apiError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return apiError(res, 500, 'Server error', 'Org database is not available.');

    const sprintId = await resolveActiveSprintId(req.orgDb, projectId);
    const [developersResp, riskResp] = await Promise.all([
      req.orgDb.query(
        `SELECT
           dp.id AS developer_id,
           COALESCE(tm.full_name, tm.email) AS developer_name,
           dp.skill_levels,
           dp.current_sprint_load,
           dp.max_sprint_capacity,
           dp.avg_pr_review_hours
         FROM developer_profiles dp
         JOIN team_members tm ON tm.id = dp.member_id
         WHERE tm.is_active = TRUE
           AND (
             EXISTS (
               SELECT 1 FROM project_members pm
               WHERE pm.project_id = $1
                 AND pm.member_id = tm.id
             )
             OR NOT EXISTS (SELECT 1 FROM project_members pm2 WHERE pm2.project_id = $1)
           )
         ORDER BY tm.full_name ASC`,
        [projectId]
      ),
      req.orgDb.query(
        `SELECT
           t.assignee_id AS developer_id,
           COUNT(*)::int FILTER (WHERE t.status = 'done') AS done_count,
           COUNT(*)::int FILTER (WHERE t.status = 'blocked') AS blocked_count,
           COUNT(*)::int FILTER (
             WHERE t.status = 'done'
               AND t.due_date IS NOT NULL
               AND t.completed_at IS NOT NULL
               AND t.completed_at::date <= t.due_date
           ) AS done_on_time
         FROM tasks t
         WHERE t.project_id = $1
           AND ($2::text = '' OR t.sprint_id = $2::uuid)
           AND t.assignee_id IS NOT NULL
         GROUP BY t.assignee_id`,
        [projectId, sprintId]
      ),
    ]);

    const riskByDev = new Map();
    for (const row of riskResp.rows || []) riskByDev.set(String(row.developer_id), row);

    const skillTagSet = new Set();
    const developers = (developersResp.rows || []).map((row) => {
      const developerId = String(row.developer_id);
      const maxCapacity = Math.max(1, toNum(row.max_sprint_capacity, 1));
      const currentLoad = Math.max(0, toNum(row.current_sprint_load, 0));
      const loadPct = Math.round((currentLoad / maxCapacity) * 100);

      const risk = riskByDev.get(developerId) || {};
      const doneCount = Math.max(0, toNum(risk.done_count, 0));
      const doneOnTime = Math.max(0, toNum(risk.done_on_time, 0));
      const blockedTasks = Math.max(0, toNum(risk.blocked_count, 0));
      const skillLevels = row.skill_levels && typeof row.skill_levels === 'object' ? row.skill_levels : {};

      for (const tag of Object.keys(skillLevels)) skillTagSet.add(String(tag));

      return {
        developerId,
        developerName: safeText(row.developer_name),
        currentLoad,
        maxCapacity,
        loadPct,
        overloadLevel: resolveLoadLevel(loadPct),
        skills: skillLevels,
        riskIndicators: {
          streakText: `${doneOnTime}/${doneCount || 0} on time`,
          blockedTasks,
          prLagHours: toNum(row.avg_pr_review_hours, 0),
          overloadWarning: resolveLoadLevel(loadPct),
        },
      };
    });

    return res.status(200).json({
      projectId,
      sprintId: sprintId || null,
      skillTags: Array.from(skillTagSet).sort((a, b) => a.localeCompare(b)),
      developers,
    });
  } catch (err) {
    return next(err);
  }
}

async function updateSkillMatrix(req, res, next) {
  try {
    const developerId = safeText(req.params.developerId);
    const skillLevels = req.body?.skillLevels;
    if (!developerId) return apiError(res, 400, 'Bad request', 'developerId is required.');
    if (!skillLevels || typeof skillLevels !== 'object') {
      return apiError(res, 400, 'Bad request', 'skillLevels object is required.');
    }
    if (!req.orgDb) return apiError(res, 500, 'Server error', 'Org database is not available.');

    const updated = await req.orgDb.query(
      `UPDATE developer_profiles
       SET skill_levels = $2::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, skill_levels`,
      [developerId, JSON.stringify(skillLevels)]
    );

    if (!updated.rows[0]) return apiError(res, 404, 'Not found', 'Developer profile not found.');
    return res.status(200).json({
      success: true,
      developerId: String(updated.rows[0].id),
      skillLevels: updated.rows[0].skill_levels || {},
    });
  } catch (err) {
    return next(err);
  }
}

async function generateRebalance(req, res, next) {
  try {
    const projectId = safeText(req.body?.projectId);
    if (!projectId) return apiError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return apiError(res, 500, 'Server error', 'Org database is not available.');

    const sprintId = await resolveActiveSprintId(req.orgDb, projectId);
    const [loadsResp, tasksResp] = await Promise.all([
      req.orgDb.query(
        `SELECT
           dp.id AS developer_id,
           COALESCE(tm.full_name, tm.email) AS developer_name,
           dp.current_sprint_load,
           dp.max_sprint_capacity,
           ROUND((dp.current_sprint_load::numeric / NULLIF(dp.max_sprint_capacity, 0)) * 100, 2) AS load_pct
         FROM developer_profiles dp
         JOIN team_members tm ON tm.id = dp.member_id
         WHERE tm.is_active = TRUE
           AND (
             EXISTS (
               SELECT 1 FROM project_members pm
               WHERE pm.project_id = $1
                 AND pm.member_id = tm.id
             )
             OR NOT EXISTS (SELECT 1 FROM project_members pm2 WHERE pm2.project_id = $1)
           )
         ORDER BY load_pct DESC NULLS LAST`,
        [projectId]
      ),
      req.orgDb.query(
        `SELECT id, title, assignee_id, story_points
         FROM tasks
         WHERE project_id = $1
           AND ($2::text = '' OR sprint_id = $2::uuid)
           AND status NOT IN ('done', 'cancelled')
           AND assignee_id IS NOT NULL
         ORDER BY priority DESC NULLS LAST, created_at ASC`,
        [projectId, sprintId]
      ),
    ]);

    const loads = (loadsResp.rows || []).map((row) => ({
      developer_id: String(row.developer_id),
      developer_name: safeText(row.developer_name),
      current_load: toNum(row.current_sprint_load, 0),
      max_capacity: Math.max(1, toNum(row.max_sprint_capacity, 1)),
      load_pct: toNum(row.load_pct, 0),
    }));

    if (loads.length < 2) return res.status(200).json({ moves: [], detail: 'Not enough developers for rebalance.' });

    const overloaded = [...loads].sort((a, b) => b.load_pct - a.load_pct).find((x) => x.load_pct > 80);
    const underloaded = [...loads].sort((a, b) => a.load_pct - b.load_pct).find((x) => x.load_pct < 70);
    if (!overloaded || !underloaded || overloaded.developer_id === underloaded.developer_id) {
      return res.status(200).json({ moves: [], detail: 'No meaningful rebalance opportunity found.' });
    }

    const candidateTasks = (tasksResp.rows || []).filter((row) => String(row.assignee_id) === overloaded.developer_id);
    const moves = [];
    let fromLoad = overloaded.current_load;
    let toLoad = underloaded.current_load;

    for (const task of candidateTasks.slice(0, 8)) {
      const pts = Math.max(1, toNum(task.story_points, 1));
      const nextFromPct = Math.round(((fromLoad - pts) / overloaded.max_capacity) * 100);
      const nextToPct = Math.round(((toLoad + pts) / underloaded.max_capacity) * 100);
      if (nextToPct > 95) continue;

      moves.push({
        taskId: String(task.id),
        taskTitle: safeText(task.title),
        points: pts,
        fromAssigneeId: overloaded.developer_id,
        fromAssigneeName: overloaded.developer_name,
        toAssigneeId: underloaded.developer_id,
        toAssigneeName: underloaded.developer_name,
        before: { fromLoadPct: Math.round((fromLoad / overloaded.max_capacity) * 100), toLoadPct: Math.round((toLoad / underloaded.max_capacity) * 100) },
        after: { fromLoadPct: nextFromPct, toLoadPct: nextToPct },
        reason: buildMoveReason(task, overloaded, underloaded),
      });

      fromLoad = Math.max(0, fromLoad - pts);
      toLoad += pts;
      if (fromLoad <= overloaded.max_capacity * 0.8) break;
    }

    return res.status(200).json({
      projectId,
      sprintId: sprintId || null,
      moves,
      summary: `Proposed ${moves.length} task moves to reduce ${overloaded.developer_name}'s overload and improve balance.`,
    });
  } catch (err) {
    return next(err);
  }
}

async function applyRebalance(req, res, next) {
  try {
    const projectId = safeText(req.body?.projectId);
    const moves = Array.isArray(req.body?.moves) ? req.body.moves : [];
    if (!projectId) return apiError(res, 400, 'Bad request', 'projectId is required.');
    if (!moves.length) return apiError(res, 400, 'Bad request', 'moves array is required.');
    if (!req.orgDb) return apiError(res, 500, 'Server error', 'Org database is not available.');

    await req.orgDb.query('BEGIN');
    try {
      const applied = [];
      for (const move of moves.slice(0, 30)) {
        const taskId = safeText(move.taskId);
        const toAssigneeId = safeText(move.toAssigneeId);
        if (!taskId || !toAssigneeId) continue;

        const updated = await req.orgDb.query(
          `UPDATE tasks
           SET assignee_id = $3,
               updated_at = NOW()
           WHERE id = $1
             AND project_id = $2
           RETURNING id, assignee_id`,
          [taskId, projectId, toAssigneeId]
        );

        if (updated.rows[0]) applied.push({ taskId: String(updated.rows[0].id), assigneeId: String(updated.rows[0].assignee_id) });
      }

      await req.orgDb.query('COMMIT');
      return res.status(200).json({ success: true, appliedCount: applied.length, applied });
    } catch (innerErr) {
      await req.orgDb.query('ROLLBACK');
      throw innerErr;
    }
  } catch (err) {
    return next(err);
  }
}

async function listTeams(req, res, next) {
  try {
    const items = await teamService.list(req);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function createTeam(req, res, next) {
  try {
    const parsed = createTeamSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const item = await teamService.create(req, parsed.data);
    return res.status(201).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function deleteTeam(req, res, next) {
  try {
    const parsed = uuidSchema.safeParse(req.params.teamId);
    if (!parsed.success) return badRequest(res, 'Invalid teamId');

    const item = await teamService.remove(req, parsed.data);
    return res.status(200).json(item);
  } catch (err) {
    return next(err);
  }
}

async function listMembers(req, res, next) {
  try {
    const parsed = uuidSchema.safeParse(req.params.teamId);
    if (!parsed.success) return badRequest(res, 'Invalid teamId');

    const items = await teamService.members(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function addMember(req, res, next) {
  try {
    const parsedTeam = uuidSchema.safeParse(req.params.teamId);
    if (!parsedTeam.success) return badRequest(res, 'Invalid teamId');

    const parsed = addTeamMemberSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const item = await teamService.addMember(req, parsedTeam.data, parsed.data);
    return res.status(200).json(item);
  } catch (err) {
    return next(err);
  }
}

async function removeMember(req, res, next) {
  try {
    const parsedTeam = uuidSchema.safeParse(req.params.teamId);
    if (!parsedTeam.success) return badRequest(res, 'Invalid teamId');

    const parsedMember = uuidSchema.safeParse(req.params.memberId);
    if (!parsedMember.success) return badRequest(res, 'Invalid memberId');

    const item = await teamService.removeMember(req, parsedTeam.data, parsedMember.data);
    return res.status(200).json(item);
  } catch (err) {
    return next(err);
  }
}

async function createJoinRequest(req, res, next) {
  try {
    const parsedTeam = uuidSchema.safeParse(req.params.teamId);
    if (!parsedTeam.success) return badRequest(res, 'Invalid teamId');

    const parsed = createJoinRequestSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const item = await teamService.requestJoin(req, parsedTeam.data, parsed.data);
    return res.status(201).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function listJoinRequests(req, res, next) {
  try {
    const parsed = uuidSchema.safeParse(req.params.teamId);
    if (!parsed.success) return badRequest(res, 'Invalid teamId');

    const items = await teamService.requests(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function reviewJoinRequest(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.requestId);
    if (!parsedId.success) return badRequest(res, 'Invalid requestId');

    const parsed = reviewJoinRequestSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const item = await teamService.reviewRequest(req, parsedId.data, parsed.data);
    return res.status(200).json(item);
  } catch (err) {
    return next(err);
  }
}

async function listScores(req, res, next) {
  try {
    const parsed = uuidSchema.safeParse(req.params.teamId);
    if (!parsed.success) return badRequest(res, 'Invalid teamId');

    const items = await teamService.scores(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function updateScore(req, res, next) {
  try {
    const parsedTeam = uuidSchema.safeParse(req.params.teamId);
    if (!parsedTeam.success) return badRequest(res, 'Invalid teamId');

    const parsedMember = uuidSchema.safeParse(req.params.memberId);
    if (!parsedMember.success) return badRequest(res, 'Invalid memberId');

    const parsed = updateScoreSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const item = await teamService.updateScore(req, parsedTeam.data, parsedMember.data, parsed.data);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getIntelligence,
  updateSkillMatrix,
  generateRebalance,
  applyRebalance,
  listTeams,
  createTeam,
  deleteTeam,
  listMembers,
  addMember,
  removeMember,
  createJoinRequest,
  listJoinRequests,
  reviewJoinRequest,
  listScores,
  updateScore,
};
