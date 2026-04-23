const { db } = require('../config/database');

// Cache schema initialization state to avoid repeated checks
const schemaInitCache = new Map(); // orgId -> { tenantOk: bool, meetingsOk: bool, timestamp }
const schemaInitInFlight = new Map(); // orgId -> Promise<void>
const SCHEMA_CACHE_TTL = 3600000; // 1 hour
const profileSyncCache = new Map(); // orgId -> timestamp
const profileSyncInFlight = new Map(); // orgId -> Promise<void>
const PROFILE_SYNC_TTL = 300000; // 5 minutes

function isRetryableConnectionError(err) {
  const code = String(err?.code || '').toUpperCase();
  const message = String(err?.message || '').toLowerCase();
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENETUNREACH' ||
    code === 'EHOSTUNREACH' ||
    code === '08003' ||
    code === '08006' ||
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
    message.includes('timeout') ||
    message.includes('timedout') ||
    message.includes('connection terminated') ||
    message.includes('server closed the connection unexpectedly') ||
    message.includes('connection reset') ||
    message.includes('cannot use a pool after calling end on the pool')
  );
}

async function withOrgPoolRetry(orgId, pool, operation) {
  try {
    const result = await operation(pool);
    return { pool, result };
  } catch (err) {
    if (!isRetryableConnectionError(err)) throw err;

    console.warn(`Transient org DB error for org ${orgId}. Recreating tenant pool and retrying once.`, err?.code || err?.message || err);

    schemaInitCache.delete(String(orgId));
    schemaInitInFlight.delete(String(orgId));

    try {
      await db.releaseOrgPool(orgId);
    } catch {
      // ignore release errors and attempt fresh pool acquisition
    }

    const freshPool = await db.getOrgPool(orgId);
    const result = await operation(freshPool);
    return { pool: freshPool, result };
  }
}

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
    // Meetings tables are only required for routes under the meetings surface.
    // Keep auth/projects/tasks available even when older tenant DBs have not been migrated yet.
    const requestPath = String(pool?.__lastRequestPath || '').toLowerCase();
    if (requestPath.includes('/meetings') || requestPath.includes('/meeting')) {
      await ensureMeetingsSchema(pool);
    }
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

async function ensureDeveloperProfiles(orgPool) {
  await orgPool.query(
    `INSERT INTO developer_profiles (member_id, primary_role)
     SELECT
       tm.id,
       CASE
         WHEN tm.role = 'qa' THEN 'QA'
         WHEN tm.role = 'designer' THEN 'Designer'
         WHEN tm.role = 'manager' THEN 'Manager'
         ELSE 'Fullstack'
       END
     FROM team_members tm
     LEFT JOIN developer_profiles dp ON dp.member_id = tm.id
     WHERE tm.is_active = TRUE
       AND tm.role <> 'viewer'
       AND dp.id IS NULL
     ON CONFLICT (member_id) DO NOTHING`
  );
}

async function ensureDeveloperProfilesOnceForOrg(orgId, pool) {
  const now = Date.now();
  const lastSyncedAt = profileSyncCache.get(String(orgId));
  if (lastSyncedAt && now - Number(lastSyncedAt) < PROFILE_SYNC_TTL) return;

  const inFlight = profileSyncInFlight.get(String(orgId));
  if (inFlight) {
    await inFlight;
    return;
  }

  const syncPromise = (async () => {
    await ensureDeveloperProfiles(pool);
    profileSyncCache.set(String(orgId), Date.now());
  })();

  profileSyncInFlight.set(String(orgId), syncPromise);
  try {
    await syncPromise;
  } finally {
    profileSyncInFlight.delete(String(orgId));
  }
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
      pool.__lastRequestPath = String(req.originalUrl || req.url || '');
    } catch (poolError) {
      const poolMsg = String(poolError?.message || poolError);
      console.error('getOrgPool failed for orgId:', orgId, 'error:', poolError);
      return res.status(503).json({
        error: 'Organization database unavailable',
        code: 'ORG_DB_UNAVAILABLE',
        detail: `Failed to get org pool: ${poolMsg}. Ensure: (1) org database exists for ${orgId}, (2) UNIVERSAL_DATABASE_URL env var is set, (3) database connection string is valid.`,
      });
    }

    // One-time schema check per org (cached + de-duped for concurrent requests).
    try {
      const out = await withOrgPoolRetry(String(orgId), pool, async (candidatePool) => {
        candidatePool.__lastRequestPath = String(req.originalUrl || req.url || '');
        await ensureSchemasOnceForOrg(String(orgId), candidatePool);
        return null;
      });
      pool = out.pool;
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
      const out = await withOrgPoolRetry(String(orgId), pool, async (candidatePool) => {
        candidatePool.__lastRequestPath = String(req.originalUrl || req.url || '');
        return ensureTeamMember({
          orgPool: candidatePool,
          userId: req?.user?.userId,
          tokenRole: req?.user?.role,
        });
      });
      pool = out.pool;
      actorMemberId = out.result;
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

    try {
      const out = await withOrgPoolRetry(String(orgId), pool, async (candidatePool) => {
        candidatePool.__lastRequestPath = String(req.originalUrl || req.url || '');
        await ensureDeveloperProfilesOnceForOrg(String(orgId), candidatePool);
        return null;
      });
      pool = out.pool;
    } catch (profileSyncError) {
      console.warn('ensureDeveloperProfiles skipped due failure:', profileSyncError?.message || profileSyncError);
    }

    try {
      const out = await withOrgPoolRetry(String(orgId), pool, async (candidatePool) => {
        candidatePool.__lastRequestPath = String(req.originalUrl || req.url || '');
        await ensureDefaultProject({ orgPool: candidatePool, actorMemberId, tokenRole: req?.user?.role });
        return null;
      });
      pool = out.pool;
    } catch (defaultProjectError) {
      console.warn('ensureDefaultProject skipped due transient or non-critical failure:', defaultProjectError?.message || defaultProjectError);
    }

    req.orgDb = pool;
    req.orgQuery = (sql, params) => pool.query(sql, params);

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
