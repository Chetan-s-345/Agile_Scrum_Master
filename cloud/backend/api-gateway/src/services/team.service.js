function requireOrgDb(req) {
  const pool = req.orgDb;
  if (!pool) throw Object.assign(new Error('Org DB not attached'), { statusCode: 500 });
  return pool;
}

function isOrgAdmin(req) {
  const role = String(req.user?.role || '');
  return ['owner', 'admin', 'manager'].includes(role);
}

async function actorMemberId(orgPool, userId) {
  const resp = await orgPool.query('SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1', [String(userId || '')]);
  return resp.rows[0]?.id || null;
}

async function ensureTeamExists(orgPool, teamId) {
  const resp = await orgPool.query('SELECT id, name, description, is_active, created_at FROM teams WHERE id = $1 LIMIT 1', [String(teamId)]);
  const row = resp.rows[0];
  if (!row) throw Object.assign(new Error('Team not found'), { statusCode: 404 });
  return row;
}

async function ensureAdminAccess(req, orgPool, teamId) {
  if (isOrgAdmin(req)) return;
  const memberId = await actorMemberId(orgPool, req.user?.userId);
  if (!memberId) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });

  const resp = await orgPool.query(
    `SELECT 1 FROM team_memberships WHERE team_id = $1 AND member_id = $2 AND role = 'admin' LIMIT 1`,
    [String(teamId), String(memberId)]
  );
  if (!resp.rows.length) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

class TeamService {
  async list(req) {
    const orgPool = requireOrgDb(req);
    const myMemberId = await actorMemberId(orgPool, req.user?.userId);

    const resp = await orgPool.query(
      `SELECT
         t.id,
         t.name,
         t.description,
         t.is_active,
         t.created_at,
         COUNT(DISTINCT tm.member_id)::int AS members_count,
         COUNT(DISTINCT jr.id) FILTER (WHERE jr.status = 'pending')::int AS pending_requests,
         MAX(tm.role) FILTER (WHERE tm.member_id = $1) AS my_team_role
       FROM teams t
       LEFT JOIN team_memberships tm ON tm.team_id = t.id
       LEFT JOIN join_requests jr ON jr.team_id = t.id
       WHERE t.is_active = TRUE
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      [myMemberId || null]
    );

    return resp.rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      active: Boolean(r.is_active),
      createdAt: r.created_at,
      membersCount: Number(r.members_count || 0),
      pendingRequests: Number(r.pending_requests || 0),
      myTeamRole: r.my_team_role || null,
    }));
  }

  async create(req, { name, description }) {
    if (!isOrgAdmin(req)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    const orgPool = requireOrgDb(req);

    const creatorId = await actorMemberId(orgPool, req.user?.userId);
    if (!creatorId) throw Object.assign(new Error('Team member not found'), { statusCode: 404 });

    await orgPool.query('BEGIN');
    try {
      const created = await orgPool.query(
        `INSERT INTO teams (name, description, created_by) VALUES ($1,$2,$3)
         RETURNING id, name, description, created_at`,
        [String(name), description || null, String(creatorId)]
      );
      const team = created.rows[0];

      await orgPool.query(
        `INSERT INTO team_memberships (team_id, member_id, role)
         VALUES ($1,$2,'admin')
         ON CONFLICT (team_id, member_id) DO UPDATE SET role = 'admin'`,
        [String(team.id), String(creatorId)]
      );

      await orgPool.query(
        `INSERT INTO scores (team_id, member_id, score, metric, updated_by)
         VALUES ($1,$2,0,'performance',$3)
         ON CONFLICT (team_id, member_id) DO NOTHING`,
        [String(team.id), String(creatorId), String(creatorId)]
      );

      await orgPool.query('COMMIT');
      return team;
    } catch (err) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async remove(req, teamId) {
    const orgPool = requireOrgDb(req);
    await ensureAdminAccess(req, orgPool, teamId);
    const resp = await orgPool.query('DELETE FROM teams WHERE id = $1 RETURNING id', [String(teamId)]);
    if (!resp.rows.length) throw Object.assign(new Error('Team not found'), { statusCode: 404 });
    return { ok: true };
  }

  async members(req, teamId) {
    const orgPool = requireOrgDb(req);
    await ensureTeamExists(orgPool, teamId);

    const myMemberId = await actorMemberId(orgPool, req.user?.userId);
    const canViewAll = isOrgAdmin(req);

    const resp = await orgPool.query(
      `SELECT
         tm.member_id,
         m.full_name,
         m.email,
         m.role AS org_role,
         tm.role AS team_role,
         tm.joined_at,
         COALESCE(s.score, 0) AS score
       FROM team_memberships tm
       JOIN team_members m ON m.id = tm.member_id
       LEFT JOIN scores s ON s.team_id = tm.team_id AND s.member_id = tm.member_id
       WHERE tm.team_id = $1
       ORDER BY s.score DESC, m.full_name ASC`,
      [String(teamId)]
    );

    const rows = canViewAll ? resp.rows : resp.rows.filter((r) => String(r.member_id) === String(myMemberId));
    return rows.map((r) => ({
      memberId: r.member_id,
      fullName: r.full_name,
      email: r.email,
      orgRole: r.org_role,
      teamRole: r.team_role,
      joinedAt: r.joined_at,
      score: Number(r.score || 0),
    }));
  }

  async addMember(req, teamId, { memberId, role }) {
    const orgPool = requireOrgDb(req);
    await ensureAdminAccess(req, orgPool, teamId);
    await ensureTeamExists(orgPool, teamId);

    const exists = await orgPool.query('SELECT id FROM team_members WHERE id = $1 AND is_active = TRUE LIMIT 1', [String(memberId)]);
    if (!exists.rows.length) throw Object.assign(new Error('Member not found'), { statusCode: 404 });

    const actorId = await actorMemberId(orgPool, req.user?.userId);

    await orgPool.query(
      `INSERT INTO team_memberships (team_id, member_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (team_id, member_id) DO UPDATE SET role = EXCLUDED.role`,
      [String(teamId), String(memberId), String(role || 'developer')]
    );

    await orgPool.query(
      `INSERT INTO scores (team_id, member_id, score, metric, updated_by)
       VALUES ($1,$2,0,'performance',$3)
       ON CONFLICT (team_id, member_id) DO NOTHING`,
      [String(teamId), String(memberId), actorId || null]
    );

    await orgPool.query(
      `UPDATE join_requests
       SET status = 'accepted', reviewed_by = $3, reviewed_at = NOW()
       WHERE team_id = $1 AND member_id = $2 AND status = 'pending'`,
      [String(teamId), String(memberId), actorId || null]
    );

    return { ok: true };
  }

  async removeMember(req, teamId, memberId) {
    const orgPool = requireOrgDb(req);
    await ensureAdminAccess(req, orgPool, teamId);

    await orgPool.query('DELETE FROM team_memberships WHERE team_id = $1 AND member_id = $2', [String(teamId), String(memberId)]);
    await orgPool.query('DELETE FROM scores WHERE team_id = $1 AND member_id = $2', [String(teamId), String(memberId)]);
    return { ok: true };
  }

  async requestJoin(req, teamId, { note }) {
    const orgPool = requireOrgDb(req);
    await ensureTeamExists(orgPool, teamId);

    const memberId = await actorMemberId(orgPool, req.user?.userId);
    if (!memberId) throw Object.assign(new Error('Team member not found'), { statusCode: 404 });

    const existingMember = await orgPool.query('SELECT 1 FROM team_memberships WHERE team_id = $1 AND member_id = $2 LIMIT 1', [String(teamId), String(memberId)]);
    if (existingMember.rows.length) throw Object.assign(new Error('Already a team member'), { statusCode: 409 });

    const existingPending = await orgPool.query(
      `SELECT 1 FROM join_requests WHERE team_id = $1 AND member_id = $2 AND status = 'pending' LIMIT 1`,
      [String(teamId), String(memberId)]
    );
    if (existingPending.rows.length) throw Object.assign(new Error('Join request already pending'), { statusCode: 409 });

    const created = await orgPool.query(
      `INSERT INTO join_requests (team_id, member_id, status, note)
       VALUES ($1,$2,'pending',$3)
       RETURNING id, team_id, member_id, status, requested_at, note`,
      [String(teamId), String(memberId), note || null]
    );

    return created.rows[0];
  }

  async requests(req, teamId) {
    const orgPool = requireOrgDb(req);
    await ensureAdminAccess(req, orgPool, teamId);

    const resp = await orgPool.query(
      `SELECT
         jr.id,
         jr.team_id,
         jr.member_id,
         jr.status,
         jr.requested_at,
         jr.reviewed_at,
         jr.note,
         tm.full_name,
         tm.email,
         tm.role AS org_role,
         rv.full_name AS reviewed_by_name
       FROM join_requests jr
       JOIN team_members tm ON tm.id = jr.member_id
       LEFT JOIN team_members rv ON rv.id = jr.reviewed_by
       WHERE jr.team_id = $1
       ORDER BY jr.requested_at DESC`,
      [String(teamId)]
    );

    return resp.rows.map((r) => ({
      id: r.id,
      teamId: r.team_id,
      memberId: r.member_id,
      status: r.status,
      requestedAt: r.requested_at,
      reviewedAt: r.reviewed_at,
      note: r.note,
      member: { fullName: r.full_name, email: r.email, orgRole: r.org_role },
      reviewedByName: r.reviewed_by_name || null,
    }));
  }

  async reviewRequest(req, requestId, { status, note }) {
    const orgPool = requireOrgDb(req);

    const current = await orgPool.query('SELECT id, team_id, member_id, status FROM join_requests WHERE id = $1 LIMIT 1', [String(requestId)]);
    const request = current.rows[0];
    if (!request) throw Object.assign(new Error('Join request not found'), { statusCode: 404 });

    await ensureAdminAccess(req, orgPool, request.team_id);
    if (String(request.status) !== 'pending') throw Object.assign(new Error('Join request already reviewed'), { statusCode: 409 });

    const actorId = await actorMemberId(orgPool, req.user?.userId);

    await orgPool.query(
      `UPDATE join_requests
       SET status = $2, note = COALESCE($3, note), reviewed_by = $4, reviewed_at = NOW()
       WHERE id = $1`,
      [String(requestId), String(status), note || null, actorId || null]
    );

    if (status === 'accepted') {
      await orgPool.query(
        `INSERT INTO team_memberships (team_id, member_id, role)
         VALUES ($1,$2,'developer')
         ON CONFLICT (team_id, member_id) DO NOTHING`,
        [String(request.team_id), String(request.member_id)]
      );

      await orgPool.query(
        `INSERT INTO scores (team_id, member_id, score, metric, updated_by)
         VALUES ($1,$2,0,'performance',$3)
         ON CONFLICT (team_id, member_id) DO NOTHING`,
        [String(request.team_id), String(request.member_id), actorId || null]
      );
    }

    return { ok: true };
  }

  async scores(req, teamId) {
    const orgPool = requireOrgDb(req);
    await ensureTeamExists(orgPool, teamId);

    const myMemberId = await actorMemberId(orgPool, req.user?.userId);
    const canViewAll = isOrgAdmin(req);

    const resp = await orgPool.query(
      `SELECT s.member_id, tm.full_name, tm.email, tm.role AS org_role, s.score, s.metric, s.updated_at
       FROM scores s
       JOIN team_members tm ON tm.id = s.member_id
       WHERE s.team_id = $1
       ORDER BY s.score DESC, tm.full_name ASC`,
      [String(teamId)]
    );

    const rows = canViewAll ? resp.rows : resp.rows.filter((r) => String(r.member_id) === String(myMemberId));
    return rows.map((r, idx) => ({
      rank: idx + 1,
      memberId: r.member_id,
      fullName: r.full_name,
      email: r.email,
      orgRole: r.org_role,
      score: Number(r.score || 0),
      metric: r.metric,
      updatedAt: r.updated_at,
    }));
  }

  async updateScore(req, teamId, memberId, { score, metric }) {
    const orgPool = requireOrgDb(req);
    await ensureAdminAccess(req, orgPool, teamId);

    const actorId = await actorMemberId(orgPool, req.user?.userId);
    const resp = await orgPool.query(
      `INSERT INTO scores (team_id, member_id, score, metric, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (team_id, member_id) DO UPDATE SET
         score = EXCLUDED.score,
         metric = EXCLUDED.metric,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING team_id, member_id, score, metric, updated_at`,
      [String(teamId), String(memberId), Number(score), String(metric || 'performance'), actorId || null]
    );

    const row = resp.rows[0];
    return {
      teamId: row.team_id,
      memberId: row.member_id,
      score: Number(row.score || 0),
      metric: row.metric,
      updatedAt: row.updated_at,
    };
  }
}

const teamService = new TeamService();

module.exports = { teamService };
