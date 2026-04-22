function requireOrgDb(req) {
  if (!req.orgDb) throw Object.assign(new Error('Org DB not attached'), { statusCode: 500 });
  return req.orgDb;
}

function requireRole(req, allowed) {
  const role = String(req.user?.role || '');
  if (!allowed.includes(role)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function getUniqueSlug(orgPool, baseSlug) {
  const root = baseSlug || 'space';
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const found = await orgPool.query('SELECT id FROM projects WHERE slug = $1 LIMIT 1', [candidate]);
    if (!found.rows.length) return candidate;
  }
  return `${root}-${Date.now()}`;
}

async function projectChildren(orgPool, projectId) {
  const [sprints, tasks, goals] = await Promise.all([
    orgPool.query(
      `SELECT id, name, status FROM sprints WHERE project_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [String(projectId)]
    ),
    orgPool.query(
      `SELECT id, title, status FROM tasks WHERE project_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [String(projectId)]
    ),
    orgPool.query(
      `SELECT id, title, status FROM goals WHERE project_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [String(projectId)]
    ),
  ]);

  return {
    sprints: sprints.rows.map((r) => ({ id: r.id, name: r.name, status: r.status })),
    tasks: tasks.rows.map((r) => ({ id: r.id, name: r.title, status: r.status })),
    goals: goals.rows.map((r) => ({ id: r.id, name: r.title, status: r.status })),
  };
}

class SpaceService {
  async list(req) {
    const orgPool = requireOrgDb(req);
    const rows = await orgPool.query(
      `SELECT id, name, slug, status, space_order, is_space_archived, is_default_space
       FROM projects
       ORDER BY is_space_archived ASC, is_default_space DESC, space_order ASC, created_at DESC`
    );

    const hydrated = await Promise.all(
      rows.rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        archived: Boolean(r.is_space_archived),
        isDefault: Boolean(r.is_default_space),
        order: Number(r.space_order || 0),
        ...(await projectChildren(orgPool, r.id)),
      }))
    );

    return {
      spaces: hydrated.filter((s) => !s.archived),
      archived: hydrated.filter((s) => s.archived),
    };
  }

  async rename(req, id, name) {
    requireRole(req, ['owner', 'admin', 'manager']);
    const orgPool = requireOrgDb(req);
    const row = await orgPool.query('UPDATE projects SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name', [
      String(name),
      String(id),
    ]);
    if (!row.rows[0]) throw Object.assign(new Error('Space not found'), { statusCode: 404 });
    return row.rows[0];
  }

  async duplicate(req, id) {
    requireRole(req, ['owner', 'admin', 'manager']);
    const orgPool = requireOrgDb(req);
    const source = await orgPool.query('SELECT * FROM projects WHERE id = $1 LIMIT 1', [String(id)]);
    const src = source.rows[0];
    if (!src) throw Object.assign(new Error('Space not found'), { statusCode: 404 });

    const baseName = `${src.name} Copy`;
    const slug = await getUniqueSlug(orgPool, slugify(baseName));

    const inserted = await orgPool.query(
      `INSERT INTO projects
       (name, slug, description, status, tech_stack, jira_project_key, github_repo, owner_id, created_by, color, avatar_emoji, settings, space_order, is_space_archived, is_default_space)
       VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,FALSE)
       RETURNING id, name, slug`,
      [
        baseName,
        slug,
        src.description || null,
        src.tech_stack || [],
        src.jira_project_key || null,
        src.github_repo || null,
        src.owner_id || null,
        src.created_by || null,
        src.color || '#2563EB',
        src.avatar_emoji || '🚀',
        src.settings || {},
        Number(src.space_order || 0) + 1,
      ]
    );

    return inserted.rows[0];
  }

  async setDefault(req, id) {
    requireRole(req, ['owner', 'admin']);
    const orgPool = requireOrgDb(req);
    await orgPool.query('UPDATE projects SET is_default_space = FALSE');
    const updated = await orgPool.query(
      'UPDATE projects SET is_default_space = TRUE, updated_at = NOW() WHERE id = $1 RETURNING id',
      [String(id)]
    );
    if (!updated.rows[0]) throw Object.assign(new Error('Space not found'), { statusCode: 404 });
    return { ok: true };
  }

  async archive(req, id, archived) {
    requireRole(req, ['owner', 'admin']);
    const orgPool = requireOrgDb(req);
    if (archived) {
      const current = await orgPool.query('SELECT is_default_space FROM projects WHERE id = $1 LIMIT 1', [String(id)]);
      if (!current.rows[0]) throw Object.assign(new Error('Space not found'), { statusCode: 404 });
      if (current.rows[0].is_default_space) {
        throw Object.assign(new Error('Default space cannot be archived'), { statusCode: 400 });
      }
    }
    const row = await orgPool.query(
      'UPDATE projects SET is_space_archived = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_space_archived',
      [Boolean(archived), String(id)]
    );
    if (!row.rows[0]) throw Object.assign(new Error('Space not found'), { statusCode: 404 });
    return { ok: true, archived: Boolean(row.rows[0].is_space_archived) };
  }

  async remove(req, id) {
    requireRole(req, ['owner', 'admin']);
    const orgPool = requireOrgDb(req);
    const current = await orgPool.query('SELECT is_default_space FROM projects WHERE id = $1 LIMIT 1', [String(id)]);
    if (!current.rows[0]) throw Object.assign(new Error('Space not found'), { statusCode: 404 });
    if (current.rows[0].is_default_space) {
      throw Object.assign(new Error('Default space cannot be deleted'), { statusCode: 400 });
    }
    try {
      const deleted = await orgPool.query('DELETE FROM projects WHERE id = $1 RETURNING id', [String(id)]);
      if (!deleted.rows[0]) throw Object.assign(new Error('Space not found'), { statusCode: 404 });
      return { ok: true, deleted: true };
    } catch (err) {
      if (String(err?.code || '') === '23503') {
        await orgPool.query('UPDATE projects SET is_space_archived = TRUE, updated_at = NOW() WHERE id = $1', [String(id)]);
        return { ok: true, deleted: false, archived: true };
      }
      throw err;
    }
  }

  async reorder(req, ids) {
    requireRole(req, ['owner', 'admin', 'manager']);
    const orgPool = requireOrgDb(req);
    const existing = await orgPool.query('SELECT id FROM projects WHERE id = ANY($1::uuid[])', [ids]);
    if (existing.rows.length !== ids.length) {
      throw Object.assign(new Error('One or more spaces not found'), { statusCode: 400 });
    }
    await orgPool.query('BEGIN');
    try {
      for (let i = 0; i < ids.length; i += 1) {
        await orgPool.query('UPDATE projects SET space_order = $1, updated_at = NOW() WHERE id = $2', [i + 1, String(ids[i])]);
      }
      await orgPool.query('COMMIT');
      return { ok: true };
    } catch (err) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
  }
}

const spaceService = new SpaceService();

module.exports = { spaceService };
