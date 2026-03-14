function requireOrgDb(req) {
  const pool = req.orgDb;
  if (!pool) throw Object.assign(new Error('Org DB not attached'), { statusCode: 500 });
  return pool;
}

function requireRole(req, allowed) {
  const role = String(req.user?.role || '');
  return allowed.includes(role);
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

function parseDate(value) {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

class DeveloperService {
  async list(req, { role, available, minMerit }) {
    const orgPool = requireOrgDb(req);

    const where = ['tm.is_active = TRUE'];
    const params = [];

    if (role) {
      params.push(String(role));
      where.push(`LOWER(COALESCE(dp.primary_role,'')) = LOWER($${params.length})`);
    }

    if (available === true) {
      where.push(`dp.availability_status = 'available'`);
    } else if (available === false) {
      where.push(`dp.availability_status <> 'available'`);
    }

    if (typeof minMerit === 'number') {
      params.push(minMerit);
      where.push(`dp.merit_score >= $${params.length}`);
    }

    const sql = `
      SELECT
        dp.id,
        tm.full_name,
        dp.primary_role,
        dp.tech_stack,
        dp.merit_score,
        dp.current_sprint_load,
        dp.max_sprint_capacity,
        ROUND((dp.current_sprint_load::DECIMAL / NULLIF(dp.max_sprint_capacity, 0)) * 100, 2) AS load_pct,
        dp.availability_status,
        dp.burnout_risk_flag
      FROM developer_profiles dp
      JOIN team_members tm ON tm.id = dp.member_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY dp.merit_score DESC, tm.full_name ASC
    `;

    const resp = await orgPool.query(sql, params);
    return resp.rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      role: r.primary_role,
      techStack: r.tech_stack || [],
      meritScore: Number(r.merit_score),
      currentLoad: Number(r.current_sprint_load || 0),
      maxCapacity: Number(r.max_sprint_capacity || 0),
      loadPct: Number(r.load_pct || 0),
      availabilityStatus: r.availability_status,
      burnoutRiskFlag: Boolean(r.burnout_risk_flag),
    }));
  }

  async leaderboard(req) {
    const orgPool = requireOrgDb(req);
    const base = await orgPool.query(
      `SELECT id, full_name, merit_score, avg_completion_rate, avg_code_quality_score, avg_pr_review_hours, avg_peer_rating
       FROM v_developer_leaderboard
       ORDER BY merit_score DESC`
    );

    const devIds = base.rows.map((r) => r.id);
    const trendByDev = new Map();

    if (devIds.length) {
      // Get last two merit scores per developer
      const history = await orgPool.query(
        `SELECT developer_id, calculated_merit_score, calculated_at
         FROM merit_score_history
         WHERE developer_id = ANY($1::uuid[])
         ORDER BY developer_id, calculated_at DESC`,
        [devIds]
      );

      const grouped = new Map();
      for (const row of history.rows) {
        const key = String(row.developer_id);
        if (!grouped.has(key)) grouped.set(key, []);
        const arr = grouped.get(key);
        if (arr.length < 2) arr.push(Number(row.calculated_merit_score));
      }

      for (const [devId, scores] of grouped.entries()) {
        if (scores.length < 2) {
          trendByDev.set(devId, 'stable');
          continue;
        }
        const [latest, prev] = scores;
        const delta = latest - prev;
        if (delta > 0.01) trendByDev.set(devId, 'improving');
        else if (delta < -0.01) trendByDev.set(devId, 'declining');
        else trendByDev.set(devId, 'stable');
      }
    }

    return base.rows.map((r, idx) => ({
      rank: idx + 1,
      name: r.full_name,
      meritScore: Number(r.merit_score),
      completionRate: Number(r.avg_completion_rate),
      codeQuality: Number(r.avg_code_quality_score),
      prReviewSpeed: Number(r.avg_pr_review_hours),
      peerRating: Number(r.avg_peer_rating),
      trend: trendByDev.get(String(r.id)) || 'stable',
    }));
  }

  async get(req, developerId) {
    const orgPool = requireOrgDb(req);

    const profileResp = await orgPool.query(
      `SELECT
         dp.*, tm.full_name, tm.email, tm.avatar_url, tm.role AS member_role, tm.department, tm.job_title, tm.github_username
       FROM developer_profiles dp
       JOIN team_members tm ON tm.id = dp.member_id
       WHERE dp.id = $1`,
      [String(developerId)]
    );
    const profile = profileResp.rows[0];
    if (!profile) throw Object.assign(new Error('Developer not found'), { statusCode: 404 });

    const perfResp = await orgPool.query(
      `SELECT sp.*, s.name AS sprint_name, s.sprint_number, s.start_date, s.end_date
       FROM sprint_performance sp
       JOIN sprints s ON s.id = sp.sprint_id
       WHERE sp.developer_id = $1
       ORDER BY s.start_date DESC
       LIMIT 5`,
      [String(developerId)]
    );

    const meritResp = await orgPool.query(
      `SELECT sprint_id, calculated_merit_score, score_delta, calculated_at
       FROM merit_score_history
       WHERE developer_id = $1
       ORDER BY calculated_at DESC
       LIMIT 30`,
      [String(developerId)]
    );

    const leaveResp = await orgPool.query(
      `SELECT id, leave_type, start_date, end_date, reason, approved
       FROM developer_availability
       WHERE developer_id = $1 AND end_date >= CURRENT_DATE
       ORDER BY start_date ASC
       LIMIT 20`,
      [String(developerId)]
    );

    const tasksResp = await orgPool.query(
      `SELECT id, sprint_id, project_id, title, status, story_points, tech_tags, due_date, assigned_at
       FROM tasks
       WHERE assignee_id = $1 AND status NOT IN ('done','cancelled')
       ORDER BY created_at DESC
       LIMIT 50`,
      [String(developerId)]
    );

    return {
      id: profile.id,
      memberId: profile.member_id,
      fullName: profile.full_name,
      email: profile.email,
      avatarUrl: profile.avatar_url,
      memberRole: profile.member_role,
      department: profile.department,
      jobTitle: profile.job_title,
      githubUsername: profile.github_username,
      profile: {
        techStack: profile.tech_stack || [],
        skillLevels: profile.skill_levels || {},
        primaryRole: profile.primary_role,
        yearsExperience: profile.years_experience,
        preferredTaskTypes: profile.preferred_task_types || [],
        maxSprintCapacity: profile.max_sprint_capacity,
        currentSprintLoad: profile.current_sprint_load,
        meritScore: Number(profile.merit_score),
        availabilityStatus: profile.availability_status,
        burnoutRiskFlag: Boolean(profile.burnout_risk_flag),
        assignmentWeight: Number(profile.assignment_weight),
      },
      last5Sprints: perfResp.rows,
      meritHistory: meritResp.rows,
      upcomingLeave: leaveResp.rows,
      currentTasks: tasksResp.rows,
    };
  }

  async create(req, payload, context) {
    const orgPool = requireOrgDb(req);
    if (!requireRole(req, ['owner', 'admin', 'manager'])) {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    }

    const memberId = String(payload.memberId);
    const memberResp = await orgPool.query('SELECT id, github_username FROM team_members WHERE id = $1 AND is_active = TRUE', [memberId]);
    const member = memberResp.rows[0];
    if (!member) throw Object.assign(new Error('Team member not found'), { statusCode: 404 });

    const existing = await orgPool.query('SELECT id FROM developer_profiles WHERE member_id = $1', [memberId]);
    if (existing.rows.length) throw Object.assign(new Error('Developer profile already exists for this member'), { statusCode: 409 });

    const insertResp = await orgPool.query(
      `INSERT INTO developer_profiles (
         member_id, tech_stack, skill_levels, primary_role, max_sprint_capacity, years_experience
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        memberId,
        payload.techStack || [],
        payload.skillLevels || {},
        payload.primaryRole || null,
        payload.maxSprintCapacity ?? null,
        payload.yearsExperience ?? null,
      ]
    );

    if (payload.githubUsername) {
      await orgPool.query('UPDATE team_members SET github_username = $1, updated_at = NOW() WHERE id = $2', [String(payload.githubUsername), memberId]);
    }

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    await audit(orgPool, {
      actorMemberId,
      action: 'developer_profile.create',
      resourceType: 'developer_profile',
      resourceId: insertResp.rows[0].id,
      oldValue: null,
      newValue: insertResp.rows[0],
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return insertResp.rows[0];
  }

  async update(req, developerId, patch, context) {
    const orgPool = requireOrgDb(req);
    if (!requireRole(req, ['owner', 'admin', 'manager'])) {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    }

    const beforeResp = await orgPool.query('SELECT * FROM developer_profiles WHERE id = $1', [String(developerId)]);
    const before = beforeResp.rows[0];
    if (!before) throw Object.assign(new Error('Developer not found'), { statusCode: 404 });

    const sets = [];
    const params = [];
    const push = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (patch.techStack) push('tech_stack', patch.techStack);
    if (patch.skillLevels) push('skill_levels', patch.skillLevels);
    if (patch.maxSprintCapacity !== undefined) push('max_sprint_capacity', patch.maxSprintCapacity);
    if (patch.preferredTaskTypes) push('preferred_task_types', patch.preferredTaskTypes);
    if (patch.primaryRole) push('primary_role', patch.primaryRole);
    if (patch.yearsExperience !== undefined) push('years_experience', patch.yearsExperience);
    if (patch.assignmentWeight !== undefined) push('assignment_weight', patch.assignmentWeight);
    if (patch.availabilityStatus) push('availability_status', patch.availabilityStatus);
    if (patch.burnoutRiskFlag !== undefined) push('burnout_risk_flag', patch.burnoutRiskFlag);

    push('updated_at', new Date());

    const sql = `UPDATE developer_profiles SET ${sets.join(', ')} WHERE id = $${params.length + 1} RETURNING *`;
    params.push(String(developerId));

    const afterResp = await orgPool.query(sql, params);
    const after = afterResp.rows[0];

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    await audit(orgPool, {
      actorMemberId,
      action: 'developer_profile.update',
      resourceType: 'developer_profile',
      resourceId: String(developerId),
      oldValue: before,
      newValue: after,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return after;
  }

  async getAvailability(req, developerId) {
    const orgPool = requireOrgDb(req);

    const entriesResp = await orgPool.query(
      `SELECT id, leave_type, start_date, end_date, reason, approved
       FROM developer_availability
       WHERE developer_id = $1
         AND end_date >= CURRENT_DATE
         AND start_date <= (CURRENT_DATE + INTERVAL '90 days')
       ORDER BY start_date ASC`,
      [String(developerId)]
    );

    const entries = entriesResp.rows;

    const today = startOfDay(new Date());
    const days = [];
    for (let i = 0; i < 90; i++) {
      const d = addDays(today, i);
      const dIso = isoDate(d);
      const hit = entries.find((e) => dIso >= isoDate(e.start_date) && dIso <= isoDate(e.end_date));
      days.push({
        date: dIso,
        status: hit ? 'on_leave' : 'available',
        leaveType: hit ? hit.leave_type : null,
      });
    }

    return { entries, days };
  }

  async addAvailability(req, developerId, payload, context) {
    const orgPool = requireOrgDb(req);

    const start = parseDate(payload.startDate);
    const end = parseDate(payload.endDate);
    if (!start || !end) throw Object.assign(new Error('Invalid startDate/endDate'), { statusCode: 400 });
    const startIso = isoDate(start);
    const endIso = isoDate(end);
    if (endIso < startIso) throw Object.assign(new Error('endDate must be after startDate'), { statusCode: 400 });

    const overlap = await orgPool.query(
      `SELECT id FROM developer_availability
       WHERE developer_id = $1
         AND start_date <= $3::date
         AND end_date >= $2::date
       LIMIT 1`,
      [String(developerId), startIso, endIso]
    );
    if (overlap.rows.length) {
      throw Object.assign(new Error('Leave dates overlap existing leave'), { statusCode: 400 });
    }

    const insertResp = await orgPool.query(
      `INSERT INTO developer_availability (developer_id, leave_type, start_date, end_date, reason)
       VALUES ($1,$2,$3::date,$4::date,$5)
       RETURNING *`,
      [String(developerId), payload.leaveType || 'vacation', startIso, endIso, payload.reason || null]
    );

    // Minimal check: count active tasks in sprints overlapping leave window.
    const affectedResp = await orgPool.query(
      `SELECT COUNT(*)::int AS count
       FROM tasks t
       JOIN sprints s ON s.id = t.sprint_id
       WHERE t.assignee_id = $1
         AND t.status NOT IN ('done','cancelled')
         AND s.start_date <= $3::date
         AND s.end_date >= $2::date`,
      [String(developerId), startIso, endIso]
    );

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    await audit(orgPool, {
      actorMemberId,
      action: 'developer_availability.create',
      resourceType: 'developer_availability',
      resourceId: insertResp.rows[0].id,
      oldValue: null,
      newValue: insertResp.rows[0],
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { availability: insertResp.rows[0], affectedTasksCount: affectedResp.rows[0]?.count || 0 };
  }

  async deleteAvailability(req, developerId, availabilityId, context) {
    const orgPool = requireOrgDb(req);

    const resp = await orgPool.query(
      `SELECT id, start_date, end_date FROM developer_availability WHERE id = $1 AND developer_id = $2`,
      [String(availabilityId), String(developerId)]
    );
    const row = resp.rows[0];
    if (!row) throw Object.assign(new Error('Availability entry not found'), { statusCode: 404 });

    const todayIso = isoDate(new Date());
    const startIso = isoDate(row.start_date);
    if (startIso <= todayIso) {
      throw Object.assign(new Error('Cannot delete leave that has started or already passed'), { statusCode: 400 });
    }

    await orgPool.query('DELETE FROM developer_availability WHERE id = $1', [String(availabilityId)]);

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    await audit(orgPool, {
      actorMemberId,
      action: 'developer_availability.delete',
      resourceType: 'developer_availability',
      resourceId: String(availabilityId),
      oldValue: row,
      newValue: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { ok: true };
  }

  async performance(req, developerId) {
    const orgPool = requireOrgDb(req);

    const resp = await orgPool.query(
      `SELECT
         sp.story_points_assigned AS "pointsAssigned",
         sp.story_points_completed AS "pointsCompleted",
         sp.completion_rate AS "completionRate",
         sp.code_quality_score AS "codeQualityScore",
         sp.avg_pr_review_hours AS "prReviewHours",
         sp.avg_peer_rating AS "peerRating",
         (SELECT calculated_merit_score
          FROM merit_score_history msh
          WHERE msh.developer_id = sp.developer_id AND msh.sprint_id = sp.sprint_id
          ORDER BY msh.calculated_at DESC
          LIMIT 1) AS "meritScore",
         s.id AS "sprintId",
         s.name AS "sprintName",
         s.sprint_number AS "sprintNumber",
         s.start_date AS "startDate",
         s.end_date AS "endDate"
       FROM sprint_performance sp
       JOIN sprints s ON s.id = sp.sprint_id
       WHERE sp.developer_id = $1
       ORDER BY s.start_date DESC
       LIMIT 10`,
      [String(developerId)]
    );

    return resp.rows;
  }
}

const developerService = new DeveloperService();

module.exports = { developerService };
