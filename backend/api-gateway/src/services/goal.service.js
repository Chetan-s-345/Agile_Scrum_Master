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

class GoalService {
  async _hydrateDetails(orgPool, goalId) {
    const [assigneesResp, sprintsResp, reposResp, calcResp] = await Promise.all([
      orgPool.query(
        `SELECT ga.user_id AS id, tm.full_name, tm.email
         FROM goal_assignees ga
         JOIN team_members tm ON tm.id = ga.user_id
         WHERE ga.goal_id = $1
         ORDER BY tm.full_name ASC`,
        [String(goalId)]
      ),
      orgPool.query(
        `SELECT gs.sprint_id AS id, s.name
         FROM goal_sprints gs
         JOIN sprints s ON s.id = gs.sprint_id
         WHERE gs.goal_id = $1
         ORDER BY s.start_date DESC`,
        [String(goalId)]
      ),
      orgPool.query(
        `SELECT gr.repo_id AS id, r.full_name, r.name, r.language, r.private, r.html_url
         FROM goal_repos gr
         JOIN github_repos r ON r.id = gr.repo_id
         WHERE gr.goal_id = $1
         ORDER BY r.full_name ASC`,
        [String(goalId)]
      ),
      orgPool.query(
        `SELECT
           COUNT(t.id)::int AS total,
           COUNT(t.id) FILTER (WHERE t.status = 'done')::int AS completed
         FROM goal_sprints gs
         LEFT JOIN tasks t ON t.sprint_id = gs.sprint_id AND t.status <> 'cancelled'
         WHERE gs.goal_id = $1`,
        [String(goalId)]
      ),
    ]);

    const total = Number(calcResp.rows[0]?.total || 0);
    const completed = Number(calcResp.rows[0]?.completed || 0);
    const computedProgress = total > 0 ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : null;

    return {
      assignees: assigneesResp.rows.map((r) => ({ id: r.id, name: r.full_name, email: r.email })),
      sprints: sprintsResp.rows.map((r) => ({ id: r.id, name: r.name })),
      repos: reposResp.rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        name: r.name,
        language: r.language,
        private: Boolean(r.private),
        htmlUrl: r.html_url,
      })),
      computedProgress,
      totalTasks: total,
      completedTasks: completed,
    };
  }

  async list(req, filters) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);

    const where = [];
    const params = [];
    const push = (expr, val) => {
      params.push(val);
      where.push(expr.replace('?', `$${params.length}`));
    };

    if (filters.status) push('g.status = ?', String(filters.status));
    if (filters.quarter) push('g.quarter = ?', String(filters.quarter));
    if (filters.projectId) push('g.project_id = ?', String(filters.projectId));
    if (filters.assigneeId) {
      push('EXISTS (SELECT 1 FROM goal_assignees ga WHERE ga.goal_id = g.id AND ga.user_id = ?)', String(filters.assigneeId));
    }
    if (filters.mine && actorMemberId) {
      push('EXISTS (SELECT 1 FROM goal_assignees ga WHERE ga.goal_id = g.id AND ga.user_id = ?)', String(actorMemberId));
    }

    const resp = await orgPool.query(
      `SELECT g.*, p.name AS project_name, tm.full_name AS created_by_name
       FROM goals g
       LEFT JOIN projects p ON p.id = g.project_id
       LEFT JOIN team_members tm ON tm.id = g.created_by
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY g.updated_at DESC
       LIMIT 500`,
      params
    );

    const items = [];
    for (const row of resp.rows) {
      const detail = await this._hydrateDetails(orgPool, row.id);
      items.push({
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        quarter: row.quarter,
        category: row.category,
        dueDate: row.due_date,
        progress: detail.computedProgress !== null ? detail.computedProgress : Number(row.progress || 0),
        projectId: row.project_id,
        projectName: row.project_name,
        createdBy: row.created_by,
        createdByName: row.created_by_name,
        keyResults: Array.isArray(row.key_results) ? row.key_results : [],
        activityLog: Array.isArray(row.activity_log) ? row.activity_log : [],
        assignees: detail.assignees,
        sprints: detail.sprints,
        repos: detail.repos,
        taskProgress: {
          total: detail.totalTasks,
          completed: detail.completedTasks,
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    return items;
  }

  async create(req, payload) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const dueIso = payload.dueDate ? parseDateToIso(payload.dueDate) : null;
    if (payload.dueDate && !dueIso) throw Object.assign(new Error('Invalid dueDate'), { statusCode: 400 });

    await orgPool.query('BEGIN');
    try {
      const insertResp = await orgPool.query(
        `INSERT INTO goals (
           title, description, status, priority, quarter, category,
           due_date, progress, project_id, created_by, key_results, activity_log
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          String(payload.title),
          payload.description || null,
          payload.status || 'planned',
          payload.priority || 'medium',
          payload.quarter || null,
          payload.category || null,
          dueIso,
          Number(payload.progress || 0),
          payload.projectId || null,
          String(actorMemberId),
          Array.isArray(payload.keyResults) ? payload.keyResults : [],
          [
            {
              at: new Date().toISOString(),
              action: 'created',
              by: String(actorMemberId),
              detail: 'Goal created',
            },
          ],
        ]
      );

      const goal = insertResp.rows[0];
      const goalId = String(goal.id);

      if (Array.isArray(payload.assigneeIds) && payload.assigneeIds.length) {
        for (const memberId of payload.assigneeIds) {
          await orgPool.query(
            `INSERT INTO goal_assignees (goal_id, user_id)
             VALUES ($1,$2)
             ON CONFLICT (goal_id, user_id) DO NOTHING`,
            [goalId, String(memberId)]
          );
        }
      }

      if (Array.isArray(payload.sprintIds) && payload.sprintIds.length) {
        for (const sprintId of payload.sprintIds) {
          await orgPool.query(
            `INSERT INTO goal_sprints (goal_id, sprint_id)
             VALUES ($1,$2)
             ON CONFLICT (goal_id, sprint_id) DO NOTHING`,
            [goalId, String(sprintId)]
          );
        }
      }

      if (Array.isArray(payload.repos) && payload.repos.length) {
        await this._attachRepos(orgPool, goalId, payload.repos);
      }

      const detail = await this._hydrateDetails(orgPool, goalId);
      if (detail.computedProgress !== null) {
        await orgPool.query('UPDATE goals SET progress = $2, updated_at = NOW() WHERE id = $1', [goalId, detail.computedProgress]);
      }

      await orgPool.query('COMMIT');
      return { goal: { ...goal, progress: detail.computedProgress !== null ? detail.computedProgress : Number(goal.progress || 0) } };
    } catch (err) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw err;
    }
  }

  async _attachRepos(orgPool, goalId, repos) {
    for (const repo of repos) {
      let repoId = repo.repoId ? String(repo.repoId) : '';
      if (!repoId) {
        const fullName = String(repo.fullName || '').trim();
        const name = String(repo.name || fullName.split('/')[1] || '').trim();
        if (!fullName || !name) continue;

        const upsertResp = await orgPool.query(
          `INSERT INTO github_repos (
             github_repo_id, name, full_name, description, private,
             language, stars, html_url, synced_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
           ON CONFLICT (full_name) DO UPDATE SET
             name = EXCLUDED.name,
             description = COALESCE(EXCLUDED.description, github_repos.description),
             private = COALESCE(EXCLUDED.private, github_repos.private),
             language = COALESCE(EXCLUDED.language, github_repos.language),
             stars = COALESCE(EXCLUDED.stars, github_repos.stars),
             html_url = COALESCE(EXCLUDED.html_url, github_repos.html_url),
             synced_at = NOW(),
             updated_at = NOW()
           RETURNING id`,
          [
            repo.githubRepoId || null,
            name,
            fullName,
            repo.description || null,
            typeof repo.private === 'boolean' ? repo.private : false,
            repo.language || null,
            Number(repo.stars || 0),
            repo.htmlUrl || null,
          ]
        );
        repoId = String(upsertResp.rows[0]?.id || '');
      }

      if (!repoId) continue;
      await orgPool.query(
        `INSERT INTO goal_repos (goal_id, repo_id)
         VALUES ($1,$2)
         ON CONFLICT (goal_id, repo_id) DO NOTHING`,
        [String(goalId), repoId]
      );
    }
  }

  async getById(req, goalId) {
    const orgPool = requireOrgDb(req);
    const resp = await orgPool.query('SELECT g.*, p.name AS project_name FROM goals g LEFT JOIN projects p ON p.id = g.project_id WHERE g.id = $1 LIMIT 1', [
      String(goalId),
    ]);
    const row = resp.rows[0] || null;
    if (!row) return null;

    const detail = await this._hydrateDetails(orgPool, row.id);
    const progress = detail.computedProgress !== null ? detail.computedProgress : Number(row.progress || 0);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      quarter: row.quarter,
      category: row.category,
      dueDate: row.due_date,
      progress,
      projectId: row.project_id,
      projectName: row.project_name,
      keyResults: Array.isArray(row.key_results) ? row.key_results : [],
      activityLog: Array.isArray(row.activity_log) ? row.activity_log : [],
      assignees: detail.assignees,
      sprints: detail.sprints,
      repos: detail.repos,
      taskProgress: { total: detail.totalTasks, completed: detail.completedTasks },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async update(req, goalId, patch) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);

    const before = await this.getById(req, goalId);
    if (!before) throw Object.assign(new Error('Goal not found'), { statusCode: 404 });

    const dueIso = patch.dueDate !== undefined ? parseDateToIso(patch.dueDate) : undefined;
    if (patch.dueDate !== undefined && patch.dueDate && !dueIso) {
      throw Object.assign(new Error('Invalid dueDate'), { statusCode: 400 });
    }

    const sets = [];
    const params = [];
    let i = 1;
    const addSet = (sql, val) => {
      sets.push(`${sql} = $${i++}`);
      params.push(val);
    };

    if (patch.title !== undefined) addSet('title', patch.title);
    if (patch.description !== undefined) addSet('description', patch.description || null);
    if (patch.status !== undefined) addSet('status', patch.status);
    if (patch.priority !== undefined) addSet('priority', patch.priority);
    if (patch.quarter !== undefined) addSet('quarter', patch.quarter || null);
    if (patch.category !== undefined) addSet('category', patch.category || null);
    if (patch.projectId !== undefined) addSet('project_id', patch.projectId || null);
    if (patch.keyResults !== undefined) addSet('key_results', Array.isArray(patch.keyResults) ? patch.keyResults : []);
    if (patch.dueDate !== undefined) addSet('due_date', dueIso || null);

    const hasSprints = Array.isArray(before.sprints) && before.sprints.length > 0;
    if (patch.progress !== undefined && !hasSprints) addSet('progress', Number(patch.progress));

    const nextLog = Array.isArray(before.activityLog) ? [...before.activityLog] : [];
    nextLog.unshift({
      at: new Date().toISOString(),
      action: 'updated',
      by: actorMemberId ? String(actorMemberId) : null,
      detail: 'Goal updated',
    });
    addSet('activity_log', nextLog.slice(0, 80));

    params.push(String(goalId));
    await orgPool.query(`UPDATE goals SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, params);

    const detail = await this._hydrateDetails(orgPool, goalId);
    if (detail.computedProgress !== null) {
      await orgPool.query('UPDATE goals SET progress = $2, updated_at = NOW() WHERE id = $1', [String(goalId), detail.computedProgress]);
    }

    return this.getById(req, goalId);
  }

  async remove(req, goalId) {
    const orgPool = requireOrgDb(req);
    const resp = await orgPool.query('DELETE FROM goals WHERE id = $1 RETURNING id', [String(goalId)]);
    if (!resp.rows.length) throw Object.assign(new Error('Goal not found'), { statusCode: 404 });
    return { ok: true };
  }

  async addAssignees(req, goalId, assigneeIds) {
    const orgPool = requireOrgDb(req);
    for (const memberId of assigneeIds) {
      await orgPool.query(
        `INSERT INTO goal_assignees (goal_id, user_id)
         VALUES ($1,$2)
         ON CONFLICT (goal_id, user_id) DO NOTHING`,
        [String(goalId), String(memberId)]
      );
    }
    return this.getById(req, goalId);
  }

  async addRepos(req, goalId, repos) {
    const orgPool = requireOrgDb(req);
    await this._attachRepos(orgPool, goalId, repos);
    return this.getById(req, goalId);
  }

  async addSprints(req, goalId, sprintIds) {
    const orgPool = requireOrgDb(req);
    for (const sprintId of sprintIds) {
      await orgPool.query(
        `INSERT INTO goal_sprints (goal_id, sprint_id)
         VALUES ($1,$2)
         ON CONFLICT (goal_id, sprint_id) DO NOTHING`,
        [String(goalId), String(sprintId)]
      );
    }

    const detail = await this._hydrateDetails(orgPool, goalId);
    if (detail.computedProgress !== null) {
      await orgPool.query('UPDATE goals SET progress = $2, updated_at = NOW() WHERE id = $1', [String(goalId), detail.computedProgress]);
    }

    return this.getById(req, goalId);
  }
}

const goalService = new GoalService();

module.exports = {
  GoalService,
  goalService,
};
