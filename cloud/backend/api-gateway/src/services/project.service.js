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

async function ensureProjectAutomationPoliciesTable(orgPool) {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS project_automation_policies (
      project_id TEXT PRIMARY KEY,
      create_from_issue BOOLEAN NOT NULL DEFAULT TRUE,
      create_from_pr BOOLEAN NOT NULL DEFAULT TRUE,
      auto_assign BOOLEAN NOT NULL DEFAULT TRUE,
      monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      guarded_mode BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
}

class ProjectService {
  buildSlug(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async list(req, { status }) {
    const orgPool = requireOrgDb(req);

    const where = [];
    const params = [];

    if (status) {
      params.push(String(status));
      where.push(`p.status = $${params.length}`);
    }

    const sql = `
      SELECT
        p.id,
        p.name,
        p.slug,
        p.status,
        p.tech_stack,
        p.github_repo,
        COALESCE((SELECT COUNT(*) FROM project_members pm_count WHERE pm_count.project_id = p.id), 0)::int AS member_count,
        COALESCE((SELECT COUNT(*) FROM sprints s_done WHERE s_done.project_id = p.id AND s_done.status = 'completed'), 0)::int AS completed_sprints,
        (
          SELECT json_build_object(
            'id', s.id,
            'name', s.name,
            'sprintNumber', s.sprint_number,
            'startDate', s.start_date,
            'endDate', s.end_date
          )
          FROM sprints s
          WHERE s.project_id = p.id AND s.status = 'active'
          ORDER BY s.start_date DESC
          LIMIT 1
        ) AS active_sprint
      FROM projects p
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.created_at DESC
    `;

    try {
      const resp = await orgPool.query(sql, params);
      return resp.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        repo_url: r.github_repo || '',
        memberCount: Number(r.member_count || 0),
        activeSprint: r.active_sprint || null,
        completedSprints: Number(r.completed_sprints || 0),
        techStack: r.tech_stack || [],
      }));
    } catch (err) {
      console.warn('Project list aggregate query failed, falling back to basic list:', err?.message || err);
      const fallbackSql = `
        SELECT id, name, slug, status, tech_stack, github_repo
        FROM projects
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC
      `;
      const fallbackResp = await orgPool.query(fallbackSql, params);
      return fallbackResp.rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        repo_url: r.github_repo || '',
        memberCount: 0,
        activeSprint: null,
        completedSprints: 0,
        techStack: r.tech_stack || [],
      }));
    }
  }

  async create(req, payload, context) {
    const orgPool = requireOrgDb(req);

    let actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) {
      const fallbackResp = await orgPool.query(
        'SELECT id FROM team_members WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1'
      );
      actorMemberId = fallbackResp.rows[0]?.id || null;
    }
    if (!actorMemberId) throw Object.assign(new Error('No active team member found in organization'), { statusCode: 403 });

    const slugInput = payload.slug ? String(payload.slug) : this.buildSlug(payload.name);
    const slug = String(slugInput || 'project');
    const existing = await orgPool.query('SELECT id FROM projects WHERE slug = $1 LIMIT 1', [slug]);
    if (existing.rows.length) throw Object.assign(new Error('Project slug already exists'), { statusCode: 409 });

    let ownerId = actorMemberId;
    if (payload.ownerId) {
      const ownerResp = await orgPool.query('SELECT id FROM team_members WHERE id = $1 AND is_active = TRUE LIMIT 1', [String(payload.ownerId)]);
      if (!ownerResp.rows.length) throw Object.assign(new Error('ownerId not found'), { statusCode: 404 });
      ownerId = String(payload.ownerId);
    }

    await orgPool.query('BEGIN');
    try {
      const insertResp = await orgPool.query(
        `INSERT INTO projects (name, slug, description, tech_stack, jira_project_key, github_repo, owner_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          String(payload.name),
          slug,
          payload.description || null,
          payload.techStack || [],
          payload.jiraProjectKey || null,
          payload.githubRepo || null,
          ownerId,
          actorMemberId,
        ]
      );
      const project = insertResp.rows[0];

      // Ensure creator is a member
      await orgPool.query(
        `INSERT INTO project_members (project_id, member_id, role)
         VALUES ($1,$2,$3)
         ON CONFLICT (project_id, member_id) DO NOTHING`,
        [String(project.id), actorMemberId, actorMemberId === ownerId ? 'owner' : 'admin']
      );

      // If owner differs, ensure owner is also a member
      if (ownerId !== actorMemberId) {
        await orgPool.query(
          `INSERT INTO project_members (project_id, member_id, role)
           VALUES ($1,$2,'owner')
           ON CONFLICT (project_id, member_id) DO NOTHING`,
          [String(project.id), ownerId]
        );
      }

      await audit(orgPool, {
        actorMemberId,
        action: 'project.create',
        resourceType: 'project',
        resourceId: String(project.id),
        oldValue: null,
        newValue: project,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      await orgPool.query('COMMIT');
      return project;
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }
  }

  async get(req, projectId) {
    const orgPool = requireOrgDb(req);

    const projectResp = await orgPool.query('SELECT * FROM projects WHERE id = $1', [String(projectId)]);
    const project = projectResp.rows[0];
    if (!project) throw Object.assign(new Error('Project not found'), { statusCode: 404 });

    const membersResp = await orgPool.query(
      `SELECT pm.member_id, pm.role, pm.added_at, tm.full_name, tm.email, tm.avatar_url
       FROM project_members pm
       JOIN team_members tm ON tm.id = pm.member_id
       WHERE pm.project_id = $1
       ORDER BY pm.added_at ASC`,
      [String(projectId)]
    );

    const epicCountResp = await orgPool.query('SELECT COUNT(*)::int AS count FROM epics WHERE project_id = $1', [String(projectId)]);

    const sprintSummaryResp = await orgPool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'planning')::int AS planning,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
       FROM sprints
       WHERE project_id = $1`,
      [String(projectId)]
    );

    const activeSprintResp = await orgPool.query(
      `SELECT id, name, sprint_number, start_date, end_date, planned_points, completed_points
       FROM sprints
       WHERE project_id = $1 AND status = 'active'
       ORDER BY start_date DESC
       LIMIT 1`,
      [String(projectId)]
    );

    return {
      project,
      members: membersResp.rows.map((m) => ({
        memberId: m.member_id,
        role: m.role,
        addedAt: m.added_at,
        fullName: m.full_name,
        email: m.email,
        avatarUrl: m.avatar_url,
      })),
      epicsCount: epicCountResp.rows[0]?.count || 0,
      sprintsSummary: sprintSummaryResp.rows[0] || { total: 0, planning: 0, active: 0, completed: 0 },
      activeSprint: activeSprintResp.rows[0] || null,
    };
  }

  async update(req, projectId, patch, context) {
    const orgPool = requireOrgDb(req);

    const beforeResp = await orgPool.query('SELECT * FROM projects WHERE id = $1', [String(projectId)]);
    const before = beforeResp.rows[0];
    if (!before) throw Object.assign(new Error('Project not found'), { statusCode: 404 });

    const sets = [];
    const params = [];
    const push = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (patch.name !== undefined) push('name', String(patch.name));
    if (patch.description !== undefined) push('description', patch.description || null);
    if (patch.status !== undefined) push('status', String(patch.status));
    if (patch.techStack !== undefined) push('tech_stack', patch.techStack || []);
    if (patch.repo_url !== undefined) push('github_repo', String(patch.repo_url).trim() || null);
    if (patch.targetEndDate !== undefined) {
      const iso = parseDateToIso(patch.targetEndDate);
      if (!iso) throw Object.assign(new Error('Invalid targetEndDate'), { statusCode: 400 });
      push('target_end_date', iso);
    }

    push('updated_at', new Date());

    const sql = `UPDATE projects SET ${sets.join(', ')} WHERE id = $${params.length + 1} RETURNING *`;
    params.push(String(projectId));

    const afterResp = await orgPool.query(sql, params);
    const after = afterResp.rows[0];

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    await audit(orgPool, {
      actorMemberId,
      action: 'project.update',
      resourceType: 'project',
      resourceId: String(projectId),
      oldValue: before,
      newValue: after,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return after;
  }

  async remove(req, projectId, context) {
    const orgPool = requireOrgDb(req);

    const beforeResp = await orgPool.query('SELECT * FROM projects WHERE id = $1', [String(projectId)]);
    const before = beforeResp.rows[0];
    if (!before) throw Object.assign(new Error('Project not found'), { statusCode: 404 });

    await orgPool.query('BEGIN');
    try {
      await orgPool.query('DELETE FROM projects WHERE id = $1', [String(projectId)]);

      const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
      await audit(orgPool, {
        actorMemberId,
        action: 'project.delete',
        resourceType: 'project',
        resourceId: String(projectId),
        oldValue: before,
        newValue: null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      await orgPool.query('COMMIT');
      return { ok: true };
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }

      // If the project has related rows (tasks/sprints/etc), archive instead of hard-failing.
      if (String(e?.code || '') === '23503') {
        const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
        const archivedResp = await orgPool.query(
          `UPDATE projects SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING *`,
          [String(projectId)]
        );
        const archived = archivedResp.rows[0];

        await audit(orgPool, {
          actorMemberId,
          action: 'project.archive',
          resourceType: 'project',
          resourceId: String(projectId),
          oldValue: before,
          newValue: archived,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });

        return {
          ok: true,
          archived: true,
          deleted: false,
          reason: 'Project has linked records and was archived instead of deleted.',
        };
      }

      throw e;
    }
  }

  async addMember(req, projectId, payload) {
    const orgPool = requireOrgDb(req);

    const memberResp = await orgPool.query('SELECT id FROM team_members WHERE id = $1 AND is_active = TRUE LIMIT 1', [String(payload.memberId)]);
    if (!memberResp.rows.length) throw Object.assign(new Error('Member not found'), { statusCode: 404 });

    try {
      const resp = await orgPool.query(
        `INSERT INTO project_members (project_id, member_id, role)
         VALUES ($1,$2,$3)
         RETURNING *`,
        [String(projectId), String(payload.memberId), String(payload.role || 'developer')]
      );
      return resp.rows[0];
    } catch (e) {
      if (String(e?.code) === '23505') {
        throw Object.assign(new Error('Member already in project'), { statusCode: 409 });
      }
      throw e;
    }
  }

  async removeMember(req, projectId, memberId) {
    const orgPool = requireOrgDb(req);
    const resp = await orgPool.query(
      `DELETE FROM project_members WHERE project_id = $1 AND member_id = $2`,
      [String(projectId), String(memberId)]
    );
    if (!resp.rowCount) throw Object.assign(new Error('Member not in project'), { statusCode: 404 });
    return { ok: true };
  }

  async listEpics(req, projectId) {
    const orgPool = requireOrgDb(req);

    const resp = await orgPool.query(
      `SELECT
         e.*, 
         COALESCE(b.total_stories, 0)::int AS story_count,
         COALESCE(b.done_stories, 0)::int AS done_count
       FROM epics e
       LEFT JOIN (
         SELECT epic_id,
                COUNT(*) AS total_stories,
                COUNT(*) FILTER (WHERE status = 'done') AS done_stories
         FROM backlog_items
         WHERE epic_id IS NOT NULL
         GROUP BY epic_id
       ) b ON b.epic_id = e.id
       WHERE e.project_id = $1
       ORDER BY e.created_at DESC`,
      [String(projectId)]
    );

    return resp.rows.map((e) => {
      const total = Number(e.story_count || 0);
      const done = Number(e.done_count || 0);
      const progress = total > 0 ? Math.round((done / total) * 10000) / 100 : 0;
      return {
        id: e.id,
        projectId: e.project_id,
        title: e.title,
        description: e.description,
        status: e.status,
        priority: e.priority,
        startDate: e.start_date,
        targetDate: e.target_date,
        color: e.color,
        storyCount: total,
        progressPct: progress,
        createdAt: e.created_at,
        updatedAt: e.updated_at,
      };
    });
  }

  async listBacklog(req, projectId) {
    const orgPool = requireOrgDb(req);

    const resp = await orgPool.query(
      `SELECT
         b.id,
         b.project_id,
         b.epic_id,
         b.sprint_id,
         b.title,
         b.description,
         b.type,
         b.priority,
         b.status,
         b.story_points,
         b.ai_estimated_points,
         b.business_value,
         b.tech_tags,
         b.acceptance_criteria,
         b.jira_issue_id,
         b.jira_issue_key,
         b.sort_order,
         b.created_at,
         b.updated_at,
         e.title AS epic_title,
         s.name AS sprint_name
       FROM backlog_items b
       LEFT JOIN epics e ON e.id = b.epic_id
       LEFT JOIN sprints s ON s.id = b.sprint_id
       WHERE b.project_id = $1
       ORDER BY b.sort_order ASC, b.created_at DESC`,
      [String(projectId)]
    );

    return resp.rows.map((b) => ({
      id: b.id,
      projectId: b.project_id,
      epicId: b.epic_id,
      sprintId: b.sprint_id,
      title: b.title,
      description: b.description,
      type: b.type,
      priority: b.priority,
      status: b.status,
      storyPoints: b.story_points === null || b.story_points === undefined ? null : Number(b.story_points),
      aiEstimatedPoints:
        b.ai_estimated_points === null || b.ai_estimated_points === undefined ? null : Number(b.ai_estimated_points),
      businessValue: Number(b.business_value || 0),
      techTags: b.tech_tags || [],
      acceptanceCriteria: b.acceptance_criteria,
      jiraIssueId: b.jira_issue_id,
      jiraIssueKey: b.jira_issue_key,
      epicTitle: b.epic_title || null,
      sprintName: b.sprint_name || null,
      sortOrder: Number(b.sort_order || 0),
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    }));
  }

  async createEpic(req, projectId, payload) {
    const orgPool = requireOrgDb(req);

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const startIso = payload.startDate ? parseDateToIso(payload.startDate) : null;
    const targetIso = payload.targetDate ? parseDateToIso(payload.targetDate) : null;
    if (payload.startDate && !startIso) throw Object.assign(new Error('Invalid startDate'), { statusCode: 400 });
    if (payload.targetDate && !targetIso) throw Object.assign(new Error('Invalid targetDate'), { statusCode: 400 });

    const resp = await orgPool.query(
      `INSERT INTO epics (project_id, title, description, priority, start_date, target_date, color, owner_id)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8)
       RETURNING *`,
      [
        String(projectId),
        String(payload.title),
        payload.description || null,
        payload.priority || null,
        startIso,
        targetIso,
        payload.color || null,
        actorMemberId,
      ]
    );

    return resp.rows[0];
  }

  async getAutomationPolicy(req, projectId) {
    const orgPool = requireOrgDb(req);
    await ensureProjectAutomationPoliciesTable(orgPool);
    const resp = await orgPool.query(
      `SELECT create_from_issue, create_from_pr, auto_assign, monitoring_enabled, guarded_mode, updated_at
       FROM project_automation_policies
       WHERE project_id = $1
       LIMIT 1`,
      [String(projectId)]
    );
    const row = resp.rows[0];
    if (!row) {
      return {
        createFromIssue: true,
        createFromPr: true,
        autoAssign: true,
        monitoringEnabled: true,
        guardedMode: false,
      };
    }
    return {
      createFromIssue: Boolean(row.create_from_issue),
      createFromPr: Boolean(row.create_from_pr),
      autoAssign: Boolean(row.auto_assign),
      monitoringEnabled: Boolean(row.monitoring_enabled),
      guardedMode: Boolean(row.guarded_mode),
      updatedAt: row.updated_at,
    };
  }

  async updateAutomationPolicy(req, projectId, patch, context) {
    const orgPool = requireOrgDb(req);
    await ensureProjectAutomationPoliciesTable(orgPool);

    const before = await this.getAutomationPolicy(req, projectId);
    const next = {
      createFromIssue: patch.createFromIssue === undefined ? before.createFromIssue : Boolean(patch.createFromIssue),
      createFromPr: patch.createFromPr === undefined ? before.createFromPr : Boolean(patch.createFromPr),
      autoAssign: patch.autoAssign === undefined ? before.autoAssign : Boolean(patch.autoAssign),
      monitoringEnabled: patch.monitoringEnabled === undefined ? before.monitoringEnabled : Boolean(patch.monitoringEnabled),
      guardedMode: patch.guardedMode === undefined ? before.guardedMode : Boolean(patch.guardedMode),
    };

    await orgPool.query(
      `INSERT INTO project_automation_policies (
         project_id, create_from_issue, create_from_pr, auto_assign, monitoring_enabled, guarded_mode, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (project_id) DO UPDATE
       SET create_from_issue = EXCLUDED.create_from_issue,
           create_from_pr = EXCLUDED.create_from_pr,
           auto_assign = EXCLUDED.auto_assign,
           monitoring_enabled = EXCLUDED.monitoring_enabled,
           guarded_mode = EXCLUDED.guarded_mode,
           updated_at = NOW()`,
      [
        String(projectId),
        next.createFromIssue,
        next.createFromPr,
        next.autoAssign,
        next.monitoringEnabled,
        next.guardedMode,
      ]
    );

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    await audit(orgPool, {
      actorMemberId,
      action: 'project.automation_policy.update',
      resourceType: 'project',
      resourceId: String(projectId),
      oldValue: before,
      newValue: next,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return next;
  }
}

const projectService = new ProjectService();

module.exports = { projectService, ProjectService };
