const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const { Client } = require('pg');

const { env } = require('../config/env');
const { db } = require('../config/database');
const { NeonProjectManager } = require('../config/neon');
const { emailService } = require('./email.service');
const { logger } = require('../middleware/logger');
const { mapNeonProvisioningError } = require('../utils/neon-errors');
const {
  normalizeTenantDbConnectionString,
  requireTenantDbConnectionForManualMode,
} = require('../utils/tenant-db');

let _cachedTenantSchemaSql = null;

function extractTenantSchemaSql(fullSql) {
  const part2Marker = '-- PART 2:';
  const seedMarker = '-- SAMPLE SEED DATA';

  const startIdx = fullSql.indexOf(part2Marker);
  if (startIdx === -1) {
    throw new Error('Could not locate "-- PART 2:" marker in init.sql');
  }

  const endIdx = fullSql.indexOf(seedMarker, startIdx);
  if (endIdx === -1) {
    throw new Error('Could not locate "-- SAMPLE SEED DATA" marker in init.sql');
  }

  return fullSql.slice(startIdx, endIdx);
}

function getTenantSchemaSql() {
  if (_cachedTenantSchemaSql) return _cachedTenantSchemaSql;
  const sqlPath = path.join(__dirname, '..', '..', 'init.sql');
  const fullSql = fs.readFileSync(sqlPath, 'utf8');
  _cachedTenantSchemaSql = extractTenantSchemaSql(fullSql);
  return _cachedTenantSchemaSql;
}

async function getTenantSchemaState(client) {
  const resp = await client.query(
    "SELECT to_regclass('public.org_settings') AS org_settings, to_regclass('public.team_members') AS team_members"
  );
  const row = resp.rows[0] || {};
  return {
    hasOrgSettings: Boolean(row.org_settings),
    hasTeamMembers: Boolean(row.team_members),
  };
}

async function ensureTenantSchema(connectionString) {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // One integer advisory lock key for schema init.
  const lockKey = 982341;

  try {
    const before = await getTenantSchemaState(client);
    if (before.hasOrgSettings && before.hasTeamMembers) return;

    // Use a transaction-level advisory lock so it works reliably with pooled / transaction-pooled
    // connection strings (e.g., Neon "-pooler" hosts).
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

      const afterLock = await getTenantSchemaState(client);
      if (afterLock.hasOrgSettings && afterLock.hasTeamMembers) {
        await client.query('COMMIT');
        return;
      }

      const tenantSql = getTenantSchemaSql();
      await client.query(tenantSql);
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw e;
    }
  } finally {
    await client.end();
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, env.REFRESH_TOKEN_SECRET, { expiresIn: env.REFRESH_EXPIRES_IN });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.REFRESH_TOKEN_SECRET);
}

function decodeExpToDate(token) {
  const decoded = jwt.decode(token);
  const exp = decoded?.exp;
  if (!exp) return null;
  return new Date(exp * 1000);
}

function poolFromConnectionString(connectionString) {
  return new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });
}

async function resolvePlanOrSeedDefault(client, planSlug) {
  const requested = String(planSlug || 'free').trim().toLowerCase() || 'free';

  let plan = await client.query(
    'SELECT id, slug, name FROM plans WHERE slug = $1 AND is_active = TRUE LIMIT 1',
    [requested]
  );
  if (plan.rows.length) return plan.rows[0];

  await client.query(
    `INSERT INTO plans (
       name, slug, price_monthly, price_yearly,
       max_members, max_projects, max_sprints_per_mo, max_storage_gb, ai_requests_per_day,
       features, is_active
     )
     VALUES (
       'Free', 'free', 0, 0,
       5, 2, 4, 2, 50,
       '{"auto_assign":false,"burnout_detect":false,"ai_reporter":false,"skill_gap":false}'::jsonb,
       TRUE
     )
     ON CONFLICT (slug) DO UPDATE SET
       is_active = TRUE,
       updated_at = NOW()`
  );

  plan = await client.query(
    'SELECT id, slug, name FROM plans WHERE slug = $1 AND is_active = TRUE LIMIT 1',
    [requested]
  );
  if (!plan.rows.length) throw Object.assign(new Error('Invalid plan'), { statusCode: 400 });
  return plan.rows[0];
}

async function seedOrgBranch({ connectionString, orgId, user }) {
  const pool = poolFromConnectionString(connectionString);
  try {
    await pool.query(
      'INSERT INTO org_settings (org_id) VALUES ($1) ON CONFLICT (org_id) DO NOTHING',
      [String(orgId)]
    );

    await pool.query(
      'INSERT INTO team_members (global_user_id, email, full_name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (global_user_id) DO NOTHING',
      [String(user.id), String(user.email), String(user.full_name), 'owner']
    );
  } finally {
    await pool.end();
  }
}

class AuthService {
  constructor() {
    this.neon = env.TENANT_DB_PROVISIONING_MODE === 'neon' ? new NeonProjectManager() : null;
  }

  async _ensureOrgDbProvisionedForLogin({ orgId, orgSlug }) {
    if (env.TENANT_DB_PROVISIONING_MODE !== 'neon') return;
    if (!this.neon) return;
    try {
      await db.transaction(db.universalPool, async (client) => {
        // Prevent duplicate provisioning if multiple logins hit at once.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`provision-org-${String(orgId)}`]);

        const orgResp = await client.query(
          'SELECT id, slug, db_provisioned, db_connection_string, neon_branch_id FROM organizations WHERE id = $1 FOR UPDATE',
          [String(orgId)]
        );
        const org = orgResp.rows[0];
        if (!org) throw Object.assign(new Error('Organization not found'), { statusCode: 404 });

        const alreadyProvisioned = Boolean(org.db_provisioned) && Boolean(String(org.db_connection_string || '').trim());
        if (alreadyProvisioned) return;

        let connectionString = String(org.db_connection_string || '').trim() || null;
        let projectId = org.neon_branch_id ? String(org.neon_branch_id) : null;

        if (!connectionString && projectId) {
          // Best-effort metadata recovery only. Login should never create/provision DB.
          try {
            connectionString = await this.neon.getProjectConnectionString(projectId);
          } catch (e) {
            logger.warn(
              {
                orgId: String(orgId),
                orgSlug: String(org.slug || orgSlug || ''),
                projectId: String(projectId),
                status: e?.status,
                data: e?.data,
                message: e?.message,
              },
              'auth.login.neon_connection_recovery_failed'
            );
            return;
          }
        }

        // If org has no project and no connection string, keep sign-in successful.
        // DB provisioning is handled explicitly via /api/v1/org/provision-db.
        if (!connectionString) return;

        await client.query(
          'UPDATE organizations SET neon_branch_id = $1, db_connection_string = $2, db_provisioned = TRUE WHERE id = $3',
          [projectId ? String(projectId) : null, String(connectionString), String(orgId)]
        );

        await client.query(
          "INSERT INTO db_provisioning_log (org_id, db_name, action, status, started_at, completed_at) VALUES ($1, $2, 'recover-metadata', 'success', NOW(), NOW())",
          [String(orgId), `org_${String(orgId).replace(/-/g, '')}_db`]
        );
      });
    } catch (e) {
      logger.warn(
        {
          orgId: String(orgId),
          orgSlug: String(orgSlug || ''),
          message: e?.message,
          statusCode: e?.statusCode,
          causeStatus: e?.cause?.status,
        },
        'auth.login.org_db_reconcile_failed'
      );
    }
  }

  async register(
    { email, password, fullName, orgName, orgSlug, planSlug, tenantDbConnectionString },
    context = {}
  ) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedOrgSlug = typeof orgSlug === 'string' ? orgSlug.trim().toLowerCase() : '';
    const normalizedOrgName = typeof orgName === 'string' ? orgName.trim() : '';
    const normalizedFullName = String(fullName || '').trim();
    const normalizedPlanSlug = String(planSlug || 'free').trim().toLowerCase();

    const hasOrgName = Boolean(normalizedOrgName);
    const hasOrgSlug = Boolean(normalizedOrgSlug);
    const creatingOrg = hasOrgName || hasOrgSlug;

    if (!normalizedEmail) throw Object.assign(new Error('Email is required'), { statusCode: 400 });
    if (!password || String(password).length < 8) {
      throw Object.assign(new Error('Password must be at least 8 characters'), { statusCode: 400 });
    }
    if (!normalizedFullName) {
      throw Object.assign(new Error('Full name is required'), { statusCode: 400 });
    }

    if (creatingOrg && (!hasOrgName || !hasOrgSlug)) {
      throw Object.assign(new Error('Organization name and slug must both be provided'), { statusCode: 400 });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);

    let createdProjectId = null;
    try {
      const result = await db.transaction(db.universalPool, async (client) => {
        const existingUser = await client.query('SELECT id FROM global_users WHERE email = $1', [normalizedEmail]);
        if (existingUser.rows.length) throw Object.assign(new Error('Email already registered'), { statusCode: 409 });

        if (!creatingOrg) {
          const userResp = await client.query(
            'INSERT INTO global_users (email, full_name, password_hash, auth_provider) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, email_verified, created_at',
            [normalizedEmail, normalizedFullName, passwordHash, 'email']
          );
          const user = userResp.rows[0];

          const sessionId = uuidv4();
          const accessToken = signAccessToken({ userId: user.id, orgId: null, role: 'user', sessionId });
          const refreshToken = signRefreshToken({ userId: user.id, orgId: null, sessionId, type: 'refresh' });
          const expiresAt = decodeExpToDate(refreshToken);
          if (!expiresAt) throw Object.assign(new Error('Failed to issue refresh token'), { statusCode: 500 });

          await client.query(
            'INSERT INTO auth_sessions (id, user_id, org_id, token_hash, refresh_token_hash, ip_address, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [
              sessionId,
              user.id,
              null,
              sha256(accessToken),
              sha256(refreshToken),
              context.ipAddress || null,
              context.userAgent || null,
              expiresAt,
            ]
          );

          return {
            user: {
              id: user.id,
              email: user.email,
              fullName: user.full_name,
              emailVerified: user.email_verified,
            },
            org: null,
            requiresOrgSetup: true,
            tokens: { accessToken, refreshToken },
          };
        }

        const existingOrg = await client.query('SELECT id FROM organizations WHERE slug = $1', [normalizedOrgSlug]);
        if (existingOrg.rows.length) throw Object.assign(new Error('Organization slug already taken'), { statusCode: 409 });

        const planRow = await resolvePlanOrSeedDefault(client, normalizedPlanSlug);

        const userResp = await client.query(
          'INSERT INTO global_users (email, full_name, password_hash, auth_provider) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, email_verified, created_at',
          [normalizedEmail, normalizedFullName, passwordHash, 'email']
        );
        const user = userResp.rows[0];

        const orgResp = await client.query(
          "INSERT INTO organizations (name, slug, plan_id, plan_status, trial_ends_at) VALUES ($1, $2, $3, 'active', (NOW() + INTERVAL '14 days')) RETURNING id, name, slug, plan_id, plan_status, trial_ends_at, neon_branch_id, db_connection_string, db_provisioned",
          [normalizedOrgName, normalizedOrgSlug, planRow.id]
        );
        const org = orgResp.rows[0];

        await client.query(
          "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', NOW())",
          [org.id, user.id]
        );

        await client.query(
          'INSERT INTO subscriptions (org_id, plan_id, status, trial_start, trial_end) VALUES ($1, $2, $3, NOW(), (NOW() + INTERVAL \'14 days\'))',
          [org.id, planRow.id, 'active']
        );

        const manualOverrideConnection = normalizeTenantDbConnectionString(tenantDbConnectionString);
        requireTenantDbConnectionForManualMode(manualOverrideConnection, env.TENANT_DB_PROVISIONING_MODE);
        let connectionString = null;
        let neonProjectId = null;

        if (manualOverrideConnection) {
          connectionString = manualOverrideConnection;

          // Auto-initialize tenant schema (PART 2) into the provided tenant DB, so signup works
          // even when the tenant DB is a separate Neon project (not a branch).
          try {
            await ensureTenantSchema(connectionString);
          } catch (e) {
            if (e?.code === '42501') {
              throw Object.assign(
                new Error(
                  'Tenant database user lacks permissions to initialize schema (needs CREATE EXTENSION/TABLE/INDEX). Provide a connection string with sufficient privileges.'
                ),
                { statusCode: 400, cause: e }
              );
            }
            throw Object.assign(new Error('Failed to initialize tenant database schema'), {
              statusCode: 400,
              cause: e,
            });
          }
        } else {
          if (env.TENANT_DB_PROVISIONING_MODE !== 'neon') {
            throw Object.assign(
              new Error(
                'tenantDbConnectionString is required when TENANT_DB_PROVISIONING_MODE=manual. Provide a per-org Postgres/Neon connection string.'
              ),
              { statusCode: 400 }
            );
          }

          if (!this.neon) {
            throw Object.assign(
              new Error('No tenant DB connection string provided and Neon auto provisioning is not configured on this server'),
              { statusCode: 400 }
            );
          }

          let project;
          try {
            project = await this.neon.createOrgProject(org.id, org.slug);
            createdProjectId = project.projectId;
            neonProjectId = project.projectId;
          } catch (e) {
            throw mapNeonProvisioningError(e);
          }

          connectionString = project.connectionString;

          // Project-per-org starts empty; apply tenant schema before seeding.
          try {
            await ensureTenantSchema(connectionString);
          } catch (e) {
            if (e?.code === '42501') {
              throw Object.assign(
                new Error(
                  'Tenant database user lacks permissions to initialize schema (needs CREATE EXTENSION/TABLE/INDEX). Provide a connection string with sufficient privileges.'
                ),
                { statusCode: 400, cause: e }
              );
            }
            throw Object.assign(new Error('Failed to initialize tenant database schema'), {
              statusCode: 400,
              cause: e,
            });
          }
        }

        if (!connectionString) throw Object.assign(new Error('Database unavailable'), { statusCode: 503 });

        try {
          await seedOrgBranch({ connectionString, orgId: org.id, user });
        } catch (e) {
          if (e?.code === '42P01') {
            throw Object.assign(
              new Error(
                'Tenant database is missing required schema. Ensure PART 2 (tenant schema) from init.sql has been applied to that database.'
              ),
              { statusCode: 400, cause: e }
            );
          }
          throw Object.assign(new Error('Database unavailable'), { statusCode: 503, cause: e });
        }

        await client.query(
          'UPDATE organizations SET neon_branch_id = $1, db_connection_string = $2, db_provisioned = TRUE WHERE id = $3',
          [neonProjectId ? String(neonProjectId) : null, String(connectionString), org.id]
        );

        await client.query(
          "INSERT INTO db_provisioning_log (org_id, db_name, action, status, started_at, completed_at) VALUES ($1, $2, 'create', 'success', NOW(), NOW())",
          [org.id, `org_${String(org.id).replace(/-/g, '')}_db`]
        );

        const sessionId = uuidv4();
        const accessToken = signAccessToken({
          userId: user.id,
          orgId: org.id,
          role: 'owner',
          sessionId,
        });
        const refreshToken = signRefreshToken({
          userId: user.id,
          orgId: org.id,
          sessionId,
          type: 'refresh',
        });
        const expiresAt = decodeExpToDate(refreshToken);
        if (!expiresAt) throw Object.assign(new Error('Failed to issue refresh token'), { statusCode: 500 });

        await client.query(
          'INSERT INTO auth_sessions (id, user_id, org_id, token_hash, refresh_token_hash, ip_address, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [
            sessionId,
            user.id,
            org.id,
            sha256(accessToken),
            sha256(refreshToken),
            context.ipAddress || null,
            context.userAgent || null,
            expiresAt,
          ]
        );

        return {
          user: {
            id: user.id,
            email: user.email,
            fullName: user.full_name,
            emailVerified: user.email_verified,
          },
          org: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            planSlug: planRow.slug,
            planName: planRow.name,
            status: org.plan_status,
            trialEndsAt: org.trial_ends_at,
          },
          tokens: { accessToken, refreshToken },
        };
      });

      const verifyToken = jwt.sign({ type: 'verify-email', userId: result.user.id }, env.JWT_SECRET, {
        expiresIn: '24h',
      });
      const verifyUrl = `${String(env.FRONTEND_URL).replace(/\/+$/, '')}/auth/verify-email?token=${encodeURIComponent(
        verifyToken
      )}`;

      try {
        await emailService.sendVerifyEmail({
          toEmail: result.user.email,
          fullName: result.user.fullName,
          orgName: result.org?.name,
          verifyUrl,
        });
      } catch (e) {
        logger.warn('email.verify_send_failed', {
          to: result.user.email,
          code: e?.code,
          statusCode: e?.statusCode,
          message: e?.message || String(e),
        });
        if (env.NODE_ENV !== 'production') {
          console.warn('[dev] Failed to send verification email:', e?.message || e);
          console.log(`[dev] verify-email token for ${result.user.email}: ${verifyToken}`);
        }
      }

      return result;
    } catch (err) {
      if (createdProjectId && this.neon) {
        try {
          await this.neon.deleteProject(createdProjectId);
        } catch {
          // best-effort cleanup
        }
      }
      throw err;
    }
  }

  async login({ email, password, orgSlug }, context = {}) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedOrgSlug = typeof orgSlug === 'string' ? orgSlug.trim().toLowerCase() : undefined;
    const userResp = await db.universalPool.query(
      'SELECT id, email, password_hash, full_name, email_verified, is_active, locked_until FROM global_users WHERE email = $1',
      [normalizedEmail]
    );
    const user = userResp.rows[0];
    if (!user) throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });

    if (!user.is_active) throw Object.assign(new Error('Account disabled'), { statusCode: 403 });
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw Object.assign(new Error('Account locked'), { statusCode: 403 });
    }

    if (!user.password_hash) throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });

    const ok = await bcrypt.compare(String(password || ''), user.password_hash);
    if (!ok) throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });

    const membershipsResp = await db.universalPool.query(
      `SELECT o.id AS org_id, o.name AS org_name, o.slug AS org_slug, om.role
       FROM org_members om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.user_id = $1 AND om.is_active = TRUE AND o.is_active = TRUE
       ORDER BY o.created_at ASC`,
      [user.id]
    );
    const memberships = membershipsResp.rows;
    if (!memberships.length) {
      await db.universalPool.query(
        'UPDATE global_users SET last_login_at = NOW(), last_login_ip = $1, failed_login_count = 0, locked_until = NULL WHERE id = $2',
        [context.ipAddress || null, user.id]
      );

      const sessionId = uuidv4();
      const accessToken = signAccessToken({ userId: user.id, orgId: null, role: 'user', sessionId });
      const refreshToken = signRefreshToken({ userId: user.id, orgId: null, sessionId, type: 'refresh' });
      const expiresAt = decodeExpToDate(refreshToken);
      if (!expiresAt) throw Object.assign(new Error('Failed to issue refresh token'), { statusCode: 500 });

      await db.universalPool.query(
        'INSERT INTO auth_sessions (id, user_id, org_id, token_hash, refresh_token_hash, ip_address, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          sessionId,
          user.id,
          null,
          sha256(accessToken),
          sha256(refreshToken),
          context.ipAddress || null,
          context.userAgent || null,
          expiresAt,
        ]
      );

      return {
        user: { id: user.id, email: user.email, fullName: user.full_name, emailVerified: user.email_verified },
        org: null,
        requiresOrgSetup: true,
        tokens: { accessToken, refreshToken },
      };
    }

    let selected = null;
    if (normalizedOrgSlug) {
      selected = memberships.find((m) => String(m.org_slug) === String(normalizedOrgSlug));
      if (!selected) throw Object.assign(new Error('Not a member of that organization'), { statusCode: 403 });
    } else if (memberships.length > 1) {
      return {
        requiresOrgSelection: true,
        orgs: memberships.map((m) => ({
          id: m.org_id,
          name: m.org_name,
          slug: m.org_slug,
          role: m.role,
        })),
      };
    } else {
      selected = memberships[0];
    }

    // Best-effort: if org exists but tenant DB isn't provisioned, provision/recover on sign-in.
    await this._ensureOrgDbProvisionedForLogin({
      orgId: selected.org_id,
      orgSlug: selected.org_slug,
    });

    await db.universalPool.query(
      'UPDATE global_users SET last_login_at = NOW(), last_login_ip = $1, failed_login_count = 0, locked_until = NULL WHERE id = $2',
      [context.ipAddress || null, user.id]
    );

    const sessionId = uuidv4();
    const accessToken = signAccessToken({
      userId: user.id,
      orgId: selected.org_id,
      role: selected.role,
      sessionId,
    });
    const refreshToken = signRefreshToken({
      userId: user.id,
      orgId: selected.org_id,
      sessionId,
      type: 'refresh',
    });
    const expiresAt = decodeExpToDate(refreshToken);
    if (!expiresAt) throw Object.assign(new Error('Failed to issue refresh token'), { statusCode: 500 });

    await db.universalPool.query(
      'INSERT INTO auth_sessions (id, user_id, org_id, token_hash, refresh_token_hash, ip_address, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        sessionId,
        user.id,
        selected.org_id,
        sha256(accessToken),
        sha256(refreshToken),
        context.ipAddress || null,
        context.userAgent || null,
        expiresAt,
      ]
    );

    return {
      user: { id: user.id, email: user.email, fullName: user.full_name, emailVerified: user.email_verified },
      org: { id: selected.org_id, name: selected.org_name, slug: selected.org_slug },
      tokens: { accessToken, refreshToken },
    };
  }

  async refresh({ refreshToken }, context = {}) {
    if (!refreshToken) throw Object.assign(new Error('Missing refresh token'), { statusCode: 400 });

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });
    }

    if (payload?.type !== 'refresh') throw Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });

    const sessionId = payload?.sessionId;
    if (!sessionId) throw Object.assign(new Error('Invalid refresh token'), { statusCode: 401 });

    const sessionResp = await db.universalPool.query(
      'SELECT id, user_id, org_id, is_active, expires_at FROM auth_sessions WHERE id = $1 AND user_id = $2 AND org_id = $3 AND refresh_token_hash = $4',
      [String(sessionId), String(payload.userId), String(payload.orgId), sha256(refreshToken)]
    );
    const session = sessionResp.rows[0];
    if (!session || !session.is_active) throw Object.assign(new Error('Refresh token not recognized'), { statusCode: 401 });
    if (new Date(session.expires_at).getTime() < Date.now()) throw Object.assign(new Error('Refresh token expired'), { statusCode: 401 });

    const membership = await db.universalPool.query(
      'SELECT role FROM org_members WHERE user_id = $1 AND org_id = $2 AND is_active = TRUE',
      [String(payload.userId), String(payload.orgId)]
    );
    const role = membership?.rows?.[0]?.role;
    if (!role) throw Object.assign(new Error('Not a member of that organization'), { statusCode: 403 });

    const accessToken = signAccessToken({ userId: String(payload.userId), orgId: String(payload.orgId), role, sessionId });
    const newRefreshToken = signRefreshToken({ userId: String(payload.userId), orgId: String(payload.orgId), sessionId, type: 'refresh' });
    const expiresAt = decodeExpToDate(newRefreshToken);
    if (!expiresAt) throw Object.assign(new Error('Failed to issue refresh token'), { statusCode: 500 });

    await db.universalPool.query(
      'UPDATE auth_sessions SET token_hash = $1, refresh_token_hash = $2, expires_at = $3, last_used_at = NOW(), ip_address = $4, user_agent = $5 WHERE id = $6',
      [sha256(accessToken), sha256(newRefreshToken), expiresAt, context.ipAddress || null, context.userAgent || null, String(sessionId)]
    );

    return { accessToken, refreshToken: newRefreshToken };
  }

  async logout({ sessionId, userId }) {
    await db.universalPool.query(
      'UPDATE auth_sessions SET is_active = FALSE WHERE id = $1 AND user_id = $2',
      [String(sessionId), String(userId)]
    );
  }

  async forgotPassword({ email }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw Object.assign(new Error('Email is required'), { statusCode: 400 });

    const userResp = await db.universalPool.query(
      'SELECT id, email, full_name FROM global_users WHERE email = $1',
      [normalizedEmail]
    );
    const user = userResp.rows[0];
    if (!user) return; // avoid user enumeration

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);
    await db.universalPool.query(
      'INSERT INTO password_resets (user_id, token_hash) VALUES ($1, $2)',
      [user.id, tokenHash]
    );

    const resetUrl = `${String(env.FRONTEND_URL).replace(/\/+$/, '')}/auth/reset-password?token=${encodeURIComponent(
      rawToken
    )}`;

    try {
      await emailService.sendPasswordResetEmail({
        toEmail: normalizedEmail,
        fullName: user.full_name,
        resetUrl,
      });
    } catch (e) {
      logger.warn('email.password_reset_send_failed', {
        to: normalizedEmail,
        code: e?.code,
        statusCode: e?.statusCode,
        message: e?.message || String(e),
      });
      if (env.NODE_ENV !== 'production') {
        console.warn('[dev] Failed to send password reset email:', e?.message || e);
      }
    }

    if (env.NODE_ENV !== 'production') {
      // Dev-only delivery
      console.log(`[dev] password reset token for ${normalizedEmail}: ${rawToken}`);
    }
  }

  async resetPassword({ token, newPassword }) {
    if (!token) throw Object.assign(new Error('Token is required'), { statusCode: 400 });
    if (!newPassword || String(newPassword).length < 8) {
      throw Object.assign(new Error('Password must be at least 8 characters'), { statusCode: 400 });
    }

    const tokenHash = sha256(token);
    const rowResp = await db.universalPool.query(
      `SELECT pr.id, pr.user_id
       FROM password_resets pr
       WHERE pr.token_hash = $1 AND pr.used = FALSE AND pr.expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    const row = rowResp.rows[0];
    if (!row) throw Object.assign(new Error('Invalid or expired token'), { statusCode: 400 });

    const passwordHash = await bcrypt.hash(String(newPassword), 12);
    await db.universalPool.query('UPDATE global_users SET password_hash = $1 WHERE id = $2', [passwordHash, row.user_id]);
    await db.universalPool.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [row.id]);
    await db.universalPool.query('UPDATE auth_sessions SET is_active = FALSE WHERE user_id = $1', [row.user_id]);
  }

  async verifyEmail({ token }) {
    if (!token) throw Object.assign(new Error('Token is required'), { statusCode: 400 });
    let payload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET);
    } catch {
      throw Object.assign(new Error('Invalid token'), { statusCode: 400 });
    }

    if (payload?.type !== 'verify-email' || !payload?.userId) {
      throw Object.assign(new Error('Invalid token'), { statusCode: 400 });
    }

    await db.universalPool.query('UPDATE global_users SET email_verified = TRUE WHERE id = $1', [String(payload.userId)]);
  }

  async me({ userId, orgId }) {
    const userResp = await db.universalPool.query(
      'SELECT id, email, full_name, email_verified, created_at FROM global_users WHERE id = $1',
      [String(userId)]
    );
    const user = userResp.rows[0];
    if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

    const membershipsResp = await db.universalPool.query(
      `SELECT o.id AS org_id, o.name AS org_name, o.slug AS org_slug, om.role, om.joined_at
       FROM org_members om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.user_id = $1 AND om.is_active = TRUE
       ORDER BY o.created_at ASC`,
      [String(userId)]
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        emailVerified: user.email_verified,
        createdAt: user.created_at,
      },
      tenantProvisioningMode: env.TENANT_DB_PROVISIONING_MODE,
      activeOrgId: orgId || null,
      memberships: membershipsResp.rows.map((m) => ({
        org: { id: m.org_id, name: m.org_name, slug: m.org_slug },
        role: m.role,
        joinedAt: m.joined_at,
      })),
    };
  }
}

const authService = new AuthService();

module.exports = { AuthService, authService };
