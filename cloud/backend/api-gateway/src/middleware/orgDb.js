const { db } = require('../config/database');

// Cache schema initialization state to avoid repeated checks
const schemaInitCache = new Map(); // orgId -> { tenantOk: bool, meetingsOk: bool, timestamp }
const schemaInitInFlight = new Map(); // orgId -> Promise<void>
const SCHEMA_CACHE_TTL = 3600000; // 1 hour

function mapTokenRoleToTenantRole(role) {
  const r = String(role || '').trim().toLowerCase();
  if (['owner', 'admin', 'manager', 'developer', 'qa', 'designer', 'viewer'].includes(r)) return r;
  if (r === 'member') return 'developer';
  return 'developer';
}

async function ensureTenantSchema(pool) {
  const resp = await pool.query(
    "SELECT to_regclass('public.team_members') AS team_members, to_regclass('public.projects') AS projects"
  );
  const row = resp.rows[0] || {};
  const hasTeamMembers = Boolean(row.team_members);
  const hasProjects = Boolean(row.projects);
  if (!hasTeamMembers || !hasProjects) {
    throw Object.assign(
      new Error(
        'Tenant database schema is missing required tables. Ensure init.sql PART 2 has been applied to the org database.'
      ),
      {
        statusCode: 503,
        code: 'TENANT_SCHEMA_MISSING',
        details: { hasTeamMembers, hasProjects },
      }
    );
  }
}

async function ensureMeetingsSchema(pool) {
  const resp = await pool.query("SELECT to_regclass('public.meeting_sessions') AS meeting_sessions");
  const row = resp.rows[0] || {};
  if (!row.meeting_sessions) {
    throw Object.assign(new Error('Meetings schema missing in tenant database'), {
      statusCode: 503,
      code: 'MEETINGS_SCHEMA_MISSING',
      details: {
        hint: 'Run db/migrations/add_meetings_lifecycle.js for tenant DBs before using meetings endpoints.',
      },
    });
  }
}

async function ensureSchemasOnceForOrg(orgId, pool) {
  const now = Date.now();
  const cached = schemaInitCache.get(orgId);
  const isCacheValid = Boolean(cached && now - cached.timestamp < SCHEMA_CACHE_TTL);
  if (isCacheValid) return;

  const existing = schemaInitInFlight.get(orgId);
  if (existing) {
    await existing;
    return;
  }

  const initPromise = (async () => {
    const startTime = Date.now();
    await ensureTenantSchema(pool);
    await ensureMeetingsSchema(pool);
    schemaInitCache.set(orgId, {
      tenantOk: true,
      meetingsOk: true,
      timestamp: Date.now(),
    });

    const duration = Date.now() - startTime;
    if (duration > 1500) {
      console.warn(`[SCHEMA_INIT_SLOW] orgId=${orgId} took ${duration}ms`);
    }
  })();

  schemaInitInFlight.set(orgId, initPromise);
  try {
    await initPromise;
  } finally {
    schemaInitInFlight.delete(orgId);
  }
}

async function ensureTeamMember({ orgPool, userId, tokenRole }) {
  if (!userId) {
    throw Object.assign(new Error('Missing userId in token'), { statusCode: 401, code: 'MISSING_USER_ID' });
  }

  const existing = await orgPool.query(
    'SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1',
    [String(userId)]
  );
  if (existing.rows.length) return String(existing.rows[0].id);

  const userResp = await db.universalPool.query(
    'SELECT email, full_name FROM global_users WHERE id = $1 LIMIT 1',
    [String(userId)]
  );
  const user = userResp.rows[0];
  if (!user) {
    throw Object.assign(new Error('User not found'), { statusCode: 401, code: 'USER_NOT_FOUND' });
  }

  const tenantRole = mapTokenRoleToTenantRole(tokenRole);
  await orgPool.query(
    'INSERT INTO team_members (global_user_id, email, full_name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (global_user_id) DO NOTHING',
    [String(userId), String(user.email).trim().toLowerCase(), String(user.full_name || '').trim() || 'User', tenantRole]
  );

  const after = await orgPool.query(
    'SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1',
    [String(userId)]
  );
  if (!after.rows.length) {
    throw Object.assign(new Error('Failed to ensure team member'), { statusCode: 500, code: 'TEAM_MEMBER_ENSURE_FAILED' });
  }
  return String(after.rows[0].id);
}

async function ensureDefaultProject({ orgPool, actorMemberId, tokenRole }) {
  const role = String(tokenRole || '').trim().toLowerCase();
  if (!['owner', 'admin'].includes(role)) return;

  const existing = await orgPool.query('SELECT id FROM projects LIMIT 1');
  if (existing.rows.length) return;

  const slug = 'default';
  const name = 'Default Project';

  const insertResp = await orgPool.query(
    `INSERT INTO projects (name, slug, description, owner_id, created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (slug) DO NOTHING
     RETURNING id`,
    [name, slug, 'Auto-created project for new workspace', String(actorMemberId), String(actorMemberId)]
  );

  let projectId = insertResp.rows[0]?.id;
  if (!projectId) {
    const p = await orgPool.query('SELECT id FROM projects WHERE slug = $1 LIMIT 1', [slug]);
    projectId = p.rows[0]?.id;
  }
  if (!projectId) return;

  await orgPool.query(
    `INSERT INTO project_members (project_id, member_id, role)
     VALUES ($1,$2,$3)
     ON CONFLICT (project_id, member_id) DO NOTHING`,
    [String(projectId), String(actorMemberId), role === 'owner' ? 'owner' : 'admin']
  );
}

async function orgDbMiddleware(req, res, next) {
  try {
    const orgId = req?.user?.orgId;
    if (!orgId) {
      return res.status(400).json({
        error: 'Missing orgId in token',
        code: 'MISSING_ORG_ID',
        detail: 'JWT token must include orgId field. Ensure user is authenticated with valid Next.js session.',
      });
    }

    let pool;
    try {
      pool = await db.getOrgPool(orgId);
    } catch (poolError) {
      const poolMsg = String(poolError?.message || poolError);
      console.error('getOrgPool failed for orgId:', orgId, 'error:', poolError);
      return res.status(503).json({
        error: 'Organization database unavailable',
        code: 'ORG_DB_UNAVAILABLE',
        detail: `Failed to get org pool: ${poolMsg}. Ensure: (1) org database exists for ${orgId}, (2) UNIVERSAL_DATABASE_URL env var is set, (3) database connection string is valid.`,
      });
    }

    req.orgDb = pool;
    req.orgQuery = (sql, params) => pool.query(sql, params);

    // One-time schema check per org (cached + de-duped for concurrent requests).
    try {
      await ensureSchemasOnceForOrg(String(orgId), pool);
    } catch (schemaError) {
      schemaInitCache.delete(String(orgId)); // invalidate cache on error
      schemaInitInFlight.delete(String(orgId));
      const schemaMsg = String(schemaError?.message || schemaError);
      console.error('Tenant schema bootstrap failed:', schemaError);
      return res.status(503).json({
        error: 'Tenant schema incomplete',
        code: 'TENANT_SCHEMA_MISSING',
        detail: `Database schema is not initialized: ${schemaMsg}. Run init.sql PART 2 on the org database.`,
      });
    }

    let actorMemberId;
    try {
      actorMemberId = await ensureTeamMember({
        orgPool: pool,
        userId: req?.user?.userId,
        tokenRole: req?.user?.role,
      });
    } catch (memberError) {
      const memberMsg = String(memberError?.message || memberError);
      console.error('ensureTeamMember failed for userId:', req?.user?.userId, 'error:', memberError);
      return res.status(memberError?.statusCode || 500).json({
        error: 'Failed to resolve team member',
        code: memberError?.code || 'TEAM_MEMBER_RESOLUTION_FAILED',
        detail: `${memberMsg}. Ensure user is registered in global_users table.`,
      });
    }

    req.actorMemberId = actorMemberId;
    await ensureDefaultProject({ orgPool: pool, actorMemberId, tokenRole: req?.user?.role });

    return next();
  } catch (err) {
    const status = err?.statusCode || err?.status || 503;
    const message = err?.message || 'Database unavailable';
    console.error('orgDbMiddleware error:', err);
    return res.status(status).json({
      error: message,
      code: err?.code || 'ORG_DB_MIDDLEWARE_ERROR',
      details: err?.details || undefined,
    });
  }
}

module.exports = { orgDbMiddleware };
