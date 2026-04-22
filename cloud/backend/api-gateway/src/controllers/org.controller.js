const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('node:fs');
const path = require('node:path');
const { Pool, Client } = require('pg');

const { env } = require('../config/env');
const { db } = require('../config/database');
const { NeonProjectManager } = require('../config/neon');
const { emailService } = require('../services/email.service');
const {
  listActivePlans,
  getActivePlanBySlug,
} = require('../services/payments/payment.service');
const { computeDiscountedAmount } = require('../services/payments/billing.logic');
const {
  listPublicCouponsDb,
  validateCouponForPlanDb,
  normalizeCouponCode: normalizeCouponCodeDb,
} = require('../services/payments/coupon.service');
const { logger } = require('../middleware/logger');
const {
  updateSettingsSchema,
  listMembersQuerySchema,
  inviteMemberSchema,
  acceptInvitationSchema,
  createOrgSchema,
  provisionDbSchema,
  billingApplyCouponSchema,
  billingCreateSubscriptionSchema,
  billingConfirmPaymentSchema,
} = require('../validators/org.schemas');
const {
  normalizeTenantDbConnectionString,
} = require('../utils/tenant-db');
const { mapNeonProvisioningError } = require('../utils/neon-errors');

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

  const lockKey = 982341;

  try {
    const before = await getTenantSchemaState(client);
    if (before.hasOrgSettings && before.hasTeamMembers) return;

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

function poolFromConnectionString(connectionString) {
  return new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });
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

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function signAccessToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, env.REFRESH_TOKEN_SECRET, { expiresIn: env.REFRESH_EXPIRES_IN });
}

function decodeExpToDate(token) {
  const decoded = jwt.decode(token);
  const exp = decoded?.exp;
  if (!exp) return null;
  return new Date(exp * 1000);
}

function requireRole(req, allowed) {
  const role = String(req.user?.role || '');
  return allowed.includes(role);
}

function maskConnectionString(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length <= 24) return '***';
  return `${raw.slice(0, 18)}...${raw.slice(-12)}`;
}

function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function resolveBaseAmountForPlan(plan, billingCycle) {
  const cycle = String(billingCycle || 'monthly').trim().toLowerCase();
  const listed = cycle === 'yearly' ? toNumber(plan?.price_yearly) : toNumber(plan?.price_monthly);
  return Math.max(0, Math.round(listed * 100) / 100);
}

async function getTenantIdForOrg(client, orgId) {
  const resp = await client.query('SELECT id FROM tenants WHERE org_id = $1 LIMIT 1', [String(orgId)]);
  return resp.rows[0]?.id || null;
}

function withSlugSuffix(baseSlug) {
  const suffix = crypto.randomBytes(3).toString('hex'); // 6 chars
  const maxBaseLen = 50;
  const trimmedBase = String(baseSlug || 'org').slice(0, maxBaseLen).replace(/-+$/g, '') || 'org';
  return `${trimmedBase}-${suffix}`;
}

async function resolveAvailableOrgSlug(client, requestedSlug, { autoResolve = true, maxAttempts = 12 } = {}) {
  const normalized = String(requestedSlug || '').trim().toLowerCase();
  if (!normalized) {
    throw Object.assign(new Error('Organization slug is required'), { statusCode: 400 });
  }

  let candidate = normalized;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const existingOrg = await client.query('SELECT id FROM organizations WHERE slug = $1 LIMIT 1', [candidate]);
    if (!existingOrg.rows.length) return candidate;

    if (!autoResolve && attempt === 0) {
      throw Object.assign(new Error('Organization slug already taken'), { statusCode: 409 });
    }
    candidate = withSlugSuffix(normalized);
  }

  throw Object.assign(new Error('Could not generate an available organization slug. Please try again.'), { statusCode: 409 });
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

async function getCurrentOrg(req, res, next) {
  try {
    const orgId = req.user?.orgId;
    if (!orgId) {
      return res.status(200).json({
        org: null,
        plan: null,
        subscription: null,
        memberCount: 0,
        requiresOrgSetup: true,
      });
    }

    const orgResp = await db.universalPool.query(
      `SELECT o.id, o.name, o.slug, o.timezone, o.logo_url, o.plan_status, o.trial_ends_at,
              o.neon_branch_id, o.db_provisioned,
              p.slug AS plan_slug, p.name AS plan_name
       FROM organizations o
       LEFT JOIN plans p ON p.id = o.plan_id
       WHERE o.id = $1`,
      [String(orgId)]
    );
    const org = orgResp.rows[0];
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const memberCountResp = await db.universalPool.query(
      'SELECT COUNT(*)::int AS count FROM org_members WHERE org_id = $1 AND is_active = TRUE',
      [String(orgId)]
    );
    const memberCount = memberCountResp.rows[0]?.count ?? 0;

    const subResp = await db.universalPool.query(
      'SELECT status, billing_cycle, current_period_start, current_period_end, trial_end FROM subscriptions WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1',
      [String(orgId)]
    );
    const subscription = subResp.rows[0] || null;

    // Backfill org plan_status from subscription status if it's stale.
    const subStatus = subscription?.status ? String(subscription.status) : null;
    if (subStatus && String(org.plan_status || '') !== subStatus) {
      await db.universalPool.query('UPDATE organizations SET plan_status = $1, updated_at = NOW() WHERE id = $2', [
        subStatus,
        String(orgId),
      ]);
      org.plan_status = subStatus;
    }

    return res.status(200).json({
      org: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        timezone: org.timezone,
        logoUrl: org.logo_url,
        status: subStatus || org.plan_status,
        trialEndsAt: org.trial_ends_at,
        dbProvisioned: org.db_provisioned,
      },
      plan: org.plan_slug ? { slug: org.plan_slug, name: org.plan_name } : null,
      subscription,
      memberCount,
    });
  } catch (err) {
    return next(err);
  }
}

async function createOrg(req, res, next) {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Unauthorized' });

    const parsed = createOrgSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });

    const normalizedOrgName = String(parsed.data.orgName || '').trim();
    const normalizedOrgSlug = String(parsed.data.orgSlug || '').trim().toLowerCase();
    const normalizedPlanSlug = String(parsed.data.planSlug || 'free').trim().toLowerCase();
    const autoResolveSlugCollision = parsed.data.autoResolveSlugCollision !== false;

    if (!normalizedOrgName) return res.status(400).json({ error: 'Organization name is required' });
    if (!normalizedOrgSlug) return res.status(400).json({ error: 'Organization slug is required' });

    const result = await db.transaction(db.universalPool, async (client) => {
      const userResp = await client.query(
        'SELECT id, email, full_name, email_verified FROM global_users WHERE id = $1',
        [String(req.user.userId)]
      );
      const user = userResp.rows[0];
      if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

      const finalOrgSlug = await resolveAvailableOrgSlug(client, normalizedOrgSlug, {
        autoResolve: autoResolveSlugCollision,
      });

      const planRow = await resolvePlanOrSeedDefault(client, normalizedPlanSlug);

      const orgResp = await client.query(
        "INSERT INTO organizations (name, slug, plan_id, plan_status, trial_ends_at) VALUES ($1, $2, $3, 'active', (NOW() + INTERVAL '14 days')) RETURNING id, name, slug, plan_id, plan_status, trial_ends_at, neon_branch_id, db_connection_string, db_provisioned",
        [normalizedOrgName, finalOrgSlug, planRow.id]
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

      // Tenant DB provisioning happens AFTER org creation, via a dedicated endpoint.
      // This avoids blocking org creation on Neon/manual DB setup.

      const sessionId = uuidv4();
      const accessToken = signAccessToken({ userId: user.id, orgId: org.id, role: 'owner', sessionId });
      const refreshToken = signRefreshToken({ userId: user.id, orgId: org.id, sessionId, type: 'refresh' });
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
          req.ip,
          req.get('user-agent') || null,
          expiresAt,
        ]
      );

      return {
        user: { id: user.id, email: user.email, fullName: user.full_name, emailVerified: user.email_verified },
        org: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          planSlug: planRow.slug,
          planName: planRow.name,
          status: org.plan_status,
          trialEndsAt: org.trial_ends_at,
          dbProvisioned: Boolean(org.db_provisioned),
        },
        tokens: { accessToken, refreshToken },
      };
    });

    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function provisionDb(req, res, next) {
  let createdProjectId = null;
  let createdProjectOrgId = null;

  try {
    if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const parsed = provisionDbSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });

    const result = await db.transaction(db.universalPool, async (client) => {
      const orgResp = await client.query(
        `SELECT o.id, o.slug, o.db_provisioned, o.db_connection_string, o.neon_branch_id, p.slug AS plan_slug
         FROM organizations o
         LEFT JOIN plans p ON p.id = o.plan_id
         WHERE o.id = $1`,
        [String(req.user.orgId)]
      );
      const org = orgResp.rows[0];
      if (!org) throw Object.assign(new Error('Organization not found'), { statusCode: 404 });
      const planSlug = String(org.plan_slug || 'free').trim().toLowerCase();
      const supportsAutoProvision = planSlug === 'pro' || planSlug === 'enterprise';

      if (org.db_provisioned && org.db_connection_string) {
        return {
          ok: true,
          provisioned: true,
          provider: env.TENANT_DB_PROVISIONING_MODE,
        };
      }

      const userResp = await client.query(
        'SELECT id, email, full_name FROM global_users WHERE id = $1',
        [String(req.user.userId)]
      );
      const user = userResp.rows[0];
      if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });

      const normalizedConn = normalizeTenantDbConnectionString(parsed.data.tenantDbConnectionString);
      let connectionString = null;
      let neonProjectId = null;

      if (normalizedConn) {
        connectionString = normalizedConn;

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
        if (!supportsAutoProvision) {
          throw Object.assign(
            new Error('Free plan requires tenantDbConnectionString. Auto-provision is available only for Pro and Enterprise.'),
            { statusCode: 400 }
          );
        }

        if (env.TENANT_DB_PROVISIONING_MODE !== 'neon') {
          throw Object.assign(new Error('tenantDbConnectionString is required for this environment.'), { statusCode: 400 });
        }

        if (!parsed.data.autoProvision) {
          throw Object.assign(new Error('Set autoProvision=true to create a tenant database automatically.'), {
            statusCode: 400,
          });
        }

        if (!env.NEON_API_KEY && !env.NEON_ORG_KEY) {
          throw Object.assign(new Error('Neon auto provisioning is not configured.'), { statusCode: 400 });
        }

        const neon = new NeonProjectManager({ orgId: parsed.data.neonOrgId });
        let project;
        try {
          project = await neon.createOrgProject(org.id, org.slug);
          createdProjectId = project.projectId;
          createdProjectOrgId = project.orgId || null;
          neonProjectId = project.projectId;
        } catch (e) {
          logger.error(
            {
              orgId: org.id,
              orgSlug: org.slug,
              errorMessage: e?.message,
              status: e?.status || e?.cause?.status,
              data: e?.data || e?.cause?.data,
            },
            'org.provisionDb.neon_provision_failed'
          );
          throw mapNeonProvisioningError(e);
        }

        connectionString = project.connectionString;

        try {
          await ensureTenantSchema(connectionString);
        } catch (e) {
          if (e?.code === '42501') {
            throw Object.assign(
              new Error('Tenant database user lacks permissions to initialize schema (needs CREATE EXTENSION/TABLE/INDEX).'),
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

      return { ok: true, provisioned: true, provider: env.TENANT_DB_PROVISIONING_MODE };
    });

    return res.status(200).json(result);
  } catch (err) {
    // Best-effort cleanup if a Neon project was created but later steps failed.
    if (createdProjectId && env.TENANT_DB_PROVISIONING_MODE === 'neon') {
      try {
        const neon = new NeonProjectManager({ orgId: createdProjectOrgId || undefined });
        await neon.deleteProject(String(createdProjectId));
      } catch {
        // ignore cleanup errors
      }
    }

    // Log provisioning failure (best effort).
    try {
      if (req.user?.orgId) {
        await db.universalPool.query(
          "INSERT INTO db_provisioning_log (org_id, db_name, action, status, error_message, started_at, completed_at) VALUES ($1, $2, 'create', 'failed', $3, NOW(), NOW())",
          [String(req.user.orgId), `org_${String(req.user.orgId).replace(/-/g, '')}_db`, String(err?.message || 'Provisioning failed')]
        );
      }
    } catch {
      // ignore logging errors
    }

    return next(err);
  }
}

async function updateSettings(req, res, next) {
  try {
    if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });

    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const { name, timezone, logo_url, notification_settings } = parsed.data;

    const beforeOrg = await db.universalPool.query('SELECT name, timezone, logo_url FROM organizations WHERE id = $1', [String(req.user.orgId)]);
    const oldUniversal = beforeOrg.rows[0] || {};

    if (name || timezone || logo_url) {
      const sets = [];
      const params = [];
      let i = 1;
      if (name) {
        sets.push(`name = $${i++}`);
        params.push(String(name));
      }
      if (timezone) {
        sets.push(`timezone = $${i++}`);
        params.push(String(timezone));
      }
      if (logo_url) {
        sets.push(`logo_url = $${i++}`);
        params.push(String(logo_url));
      }
      params.push(String(req.user.orgId));
      await db.universalPool.query(`UPDATE organizations SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, params);
    }

    const beforeSettings = await orgPool.query('SELECT notification_settings FROM org_settings WHERE org_id = $1 LIMIT 1', [String(req.user.orgId)]);
    const oldSettings = beforeSettings.rows[0] || null;
    if (notification_settings !== undefined) {
      await orgPool.query(
        'UPDATE org_settings SET notification_settings = $1, updated_at = NOW() WHERE org_id = $2',
        [notification_settings, String(req.user.orgId)]
      );
    }

    const actorMemberId = await getActorMemberId(orgPool, req.user.userId);
    await audit(orgPool, {
      actorMemberId,
      action: 'org.settings.updated',
      resourceType: 'org_settings',
      oldValue: { organizations: oldUniversal, org_settings: oldSettings },
      newValue: { organizations: { name, timezone, logo_url }, org_settings: { notification_settings } },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function deleteOrg(req, res, next) {
  try {
    const orgId = req.user?.orgId;
    if (!orgId) return res.status(400).json({ error: 'Missing orgId in token' });
    if (!requireRole(req, ['owner'])) return res.status(403).json({ error: 'Forbidden' });

    const result = await db.transaction(db.universalPool, async (client) => {
      const orgResp = await client.query(
        'SELECT id, slug, name, is_active FROM organizations WHERE id = $1 LIMIT 1',
        [String(orgId)]
      );
      const org = orgResp.rows[0];
      if (!org) throw Object.assign(new Error('Organization not found'), { statusCode: 404 });
      if (org.is_active === false) {
        return { orgId: String(org.id), slug: String(org.slug), alreadyDeleted: true };
      }

      await client.query(
        "UPDATE organizations SET is_active = FALSE, plan_status = 'cancelled', updated_at = NOW() WHERE id = $1",
        [String(orgId)]
      );

      await client.query('UPDATE org_members SET is_active = FALSE WHERE org_id = $1', [String(orgId)]);
      await client.query('UPDATE auth_sessions SET is_active = FALSE WHERE org_id = $1', [String(orgId)]);

      // Best-effort: cancel pending invitations + subscriptions if schema supports it.
      try {
        await client.query("UPDATE invitations SET status = 'cancelled' WHERE org_id = $1 AND status = 'pending'", [String(orgId)]);
      } catch {
        // ignore
      }
      try {
        await client.query(
          "UPDATE subscriptions SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()) WHERE org_id = $1 AND status <> 'cancelled'",
          [String(orgId)]
        );
      } catch {
        // ignore
      }

      return { orgId: String(org.id), slug: String(org.slug), deleted: true };
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function listMembers(req, res, next) {
  try {
    if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });

    const q = listMembersQuerySchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Validation error', details: q.error.flatten() });
    const { page, limit } = q.data;
    const offset = (page - 1) * limit;

    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const membersResp = await orgPool.query(
      `SELECT id, global_user_id, email, full_name, role, joined_at
       FROM team_members
       WHERE is_active = TRUE
       ORDER BY joined_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const lastActiveResp = await db.universalPool.query(
      'SELECT user_id, last_active_at FROM org_members WHERE org_id = $1 AND is_active = TRUE',
      [String(req.user.orgId)]
    );
    const lastActiveByUserId = new Map(lastActiveResp.rows.map((r) => [String(r.user_id), r.last_active_at]));

    return res.status(200).json({
      page,
      limit,
      members: membersResp.rows.map((m) => ({
        id: m.id,
        fullName: m.full_name,
        email: m.email,
        role: m.role,
        joinedAt: m.joined_at,
        lastActiveAt: lastActiveByUserId.get(String(m.global_user_id)) || null,
      })),
    });
  } catch (err) {
    return next(err);
  }
}

async function inviteMember(req, res, next) {
  try {
    if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const parsed = inviteMemberSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });

    const orgId = String(req.user.orgId);
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const planResp = await db.universalPool.query(
      `SELECT p.max_members
       FROM organizations o
       LEFT JOIN plans p ON p.id = o.plan_id
       WHERE o.id = $1`,
      [orgId]
    );
    const maxMembers = planResp.rows[0]?.max_members ?? 5;

    const activeMembersResp = await db.universalPool.query(
      'SELECT COUNT(*)::int AS count FROM org_members WHERE org_id = $1 AND is_active = TRUE',
      [orgId]
    );
    const activeCount = activeMembersResp.rows[0]?.count ?? 0;
    if (activeCount >= maxMembers) {
      return res.status(403).json({ error: 'Plan member limit reached' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const inviteResp = await db.universalPool.query(
      `INSERT INTO invitations (org_id, email, role, token, invited_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, role, token, status, expires_at, created_at`,
      [orgId, String(parsed.data.email).trim().toLowerCase(), String(parsed.data.role), token, String(req.user.userId)]
    );
    const invite = inviteResp.rows[0];

    if (env.NODE_ENV !== 'production') {
      console.log(`[dev] invite token for ${invite.email}: ${invite.token}`);
    }

    const actorMemberId = await getActorMemberId(orgPool, req.user.userId);
    await audit(orgPool, {
      actorMemberId,
      action: 'org.member.invited',
      resourceType: 'invitation',
      resourceId: invite.id,
      newValue: { email: invite.email, role: invite.role, expiresAt: invite.expires_at },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    const orgInfoResp = await db.universalPool.query('SELECT name, slug FROM organizations WHERE id = $1', [orgId]);
    const orgInfo = orgInfoResp.rows[0];
    const inviterResp = await db.universalPool.query('SELECT full_name FROM global_users WHERE id = $1', [
      String(req.user.userId),
    ]);
    const inviterName = inviterResp.rows[0]?.full_name || null;

    const acceptUrl = `${String(env.FRONTEND_URL).replace(/\/+$/, '')}/auth/accept-invite/${encodeURIComponent(
      invite.token
    )}`;

    let emailResult = null;

    try {
      emailResult = await emailService.sendInvitationEmail({
        toEmail: invite.email,
        orgName: orgInfo?.name,
        role: invite.role,
        invitedByName: inviterName,
        acceptUrl,
      });

      try {
        await db.universalPool.query(
          `INSERT INTO global_audit_log (actor_user_id, org_id, action, resource_type, resource_id, metadata, ip_address, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            String(req.user.userId),
            String(req.user.orgId),
            'email.invitation.sent',
            'invitation',
            invite.id,
            {
              to: invite.email,
              provider: emailResult?.provider || 'brevo',
              messageId: emailResult?.messageId || null,
            },
            req.ip,
            req.get('user-agent') || null,
          ]
        );
      } catch {
        // best-effort
      }
    } catch (e) {
      logger.warn('email.invitation_send_failed', {
        to: invite.email,
        code: e?.code,
        statusCode: e?.statusCode,
        message: e?.message || String(e),
      });

      try {
        await db.universalPool.query(
          `INSERT INTO global_audit_log (actor_user_id, org_id, action, resource_type, resource_id, metadata, ip_address, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            String(req.user.userId),
            String(req.user.orgId),
            'email.invitation.failed',
            'invitation',
            invite.id,
            {
              to: invite.email,
              code: e?.code || null,
              statusCode: e?.statusCode || null,
              details: e?.details || null,
              message: e?.message ? String(e.message) : String(e),
            },
            req.ip,
            req.get('user-agent') || null,
          ]
        );
      } catch {
        // best-effort
      }

      if (env.NODE_ENV !== 'production') {
        console.warn('[dev] Failed to send invitation email:', e?.message || e);
      }

      emailResult = {
        sent: false,
        provider: 'brevo',
        code: e?.code || null,
        statusCode: e?.statusCode || null,
        message: e?.message ? String(e.message) : 'Failed to send invitation email',
      };
    }

    return res.status(201).json({ invitation: invite, email: emailResult });
  } catch (err) {
    return next(err);
  }
}

async function emailStatus(req, res) {
  if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });
  if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

  return res.status(200).json({
    configured: emailService.isConfigured(),
    config: emailService.configState(),
  });
}

async function removeMember(req, res, next) {
  try {
    if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const memberId = String(req.params.memberId);
    const orgId = String(req.user.orgId);
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const memberResp = await orgPool.query(
      'SELECT id, global_user_id, role, is_active FROM team_members WHERE id = $1',
      [memberId]
    );
    const member = memberResp.rows[0];
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (String(member.role) === 'owner') return res.status(400).json({ error: 'Cannot remove owner' });

    await orgPool.query('UPDATE team_members SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [memberId]);
    await db.universalPool.query(
      'UPDATE org_members SET is_active = FALSE WHERE org_id = $1 AND user_id = $2',
      [orgId, String(member.global_user_id)]
    );

    const actorMemberId = await getActorMemberId(orgPool, req.user.userId);
    await audit(orgPool, {
      actorMemberId,
      action: 'org.member.removed',
      resourceType: 'team_member',
      resourceId: memberId,
      oldValue: { is_active: member.is_active, role: member.role },
      newValue: { is_active: false },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

async function listInvitations(req, res, next) {
  try {
    if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });
    const orgId = String(req.user.orgId);

    const invResp = await db.universalPool.query(
      `SELECT id, email, role, token, status, expires_at, created_at
       FROM invitations
       WHERE org_id = $1 AND status = 'pending' AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [orgId]
    );
    return res.status(200).json({ invitations: invResp.rows });
  } catch (err) {
    return next(err);
  }
}

async function acceptInvitation(req, res, next) {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const bodyParsed = acceptInvitationSchema.safeParse(req.body || {});
    if (!bodyParsed.success) return res.status(400).json({ error: 'Validation error', details: bodyParsed.error.flatten() });

    const inviteResp = await db.universalPool.query(
      `SELECT id, org_id, email, role, status, expires_at
       FROM invitations
       WHERE token = $1
       LIMIT 1`,
      [token]
    );
    const invite = inviteResp.rows[0];
    if (!invite || invite.status !== 'pending') return res.status(400).json({ error: 'Invalid invitation token' });
    if (new Date(invite.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'Invitation expired' });

    const normalizedEmail = String(invite.email).trim().toLowerCase();
    const orgId = String(invite.org_id);

    const orgConnResp = await db.universalPool.query('SELECT db_connection_string FROM organizations WHERE id = $1', [orgId]);
    const conn = orgConnResp.rows[0]?.db_connection_string;
    if (!conn) return res.status(503).json({ error: 'Database unavailable' });

    const result = await db.transaction(db.universalPool, async (client) => {
      const existingUserResp = await client.query(
        'SELECT id, email, full_name, password_hash, email_verified FROM global_users WHERE email = $1',
        [normalizedEmail]
      );
      let user = existingUserResp.rows[0];

      if (!user) {
        if (!bodyParsed.data.fullName || !bodyParsed.data.password) {
          throw Object.assign(new Error('fullName and password are required for new users'), { statusCode: 400 });
        }
        const passwordHash = await bcrypt.hash(String(bodyParsed.data.password), 12);
        const createdUser = await client.query(
          'INSERT INTO global_users (email, full_name, password_hash, auth_provider) VALUES ($1,$2,$3,$4) RETURNING id, email, full_name, email_verified',
          [normalizedEmail, String(bodyParsed.data.fullName).trim(), passwordHash, 'email']
        );
        user = createdUser.rows[0];
      }

      await client.query(
        `INSERT INTO org_members (org_id, user_id, role, joined_at, is_active)
         VALUES ($1,$2,$3,NOW(),TRUE)
         ON CONFLICT (org_id, user_id)
         DO UPDATE SET is_active = TRUE, role = EXCLUDED.role, joined_at = COALESCE(org_members.joined_at, NOW())`,
        [orgId, user.id, String(invite.role || 'member')]
      );

      await client.query('UPDATE invitations SET status = \'accepted\', accepted_at = NOW() WHERE id = $1', [invite.id]);

      const sessionId = uuidv4();
      const accessToken = signAccessToken({ userId: user.id, orgId, role: String(invite.role || 'member'), sessionId });
      const refreshToken = signRefreshToken({ userId: user.id, orgId, role: String(invite.role || 'member'), sessionId, type: 'refresh' });
      const expiresAt = decodeExpToDate(refreshToken);
      if (!expiresAt) throw Object.assign(new Error('Failed to issue refresh token'), { statusCode: 500 });

      await client.query(
        'INSERT INTO auth_sessions (id, user_id, org_id, token_hash, refresh_token_hash, ip_address, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [sessionId, user.id, orgId, sha256(accessToken), sha256(refreshToken), req.ip, req.get('user-agent') || null, expiresAt]
      );

      return { user, accessToken, refreshToken };
    });

    const orgPool = await db.getOrgPool(orgId);
    await orgPool.query(
      'INSERT INTO team_members (global_user_id, email, full_name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (global_user_id) DO NOTHING',
      [String(result.user.id), normalizedEmail, String(result.user.full_name), String(invite.role || 'member')]
    );

    const actorMemberId = await getActorMemberId(orgPool, result.user.id);
    await audit(orgPool, {
      actorMemberId,
      action: 'org.invitation.accepted',
      resourceType: 'invitation',
      resourceId: invite.id,
      newValue: { email: normalizedEmail, role: invite.role },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    const orgInfo = await db.universalPool.query('SELECT id, name, slug FROM organizations WHERE id = $1', [orgId]);
    const org = orgInfo.rows[0];

    if (org && !result.user.email_verified) {
      const verifyToken = jwt.sign({ type: 'verify-email', userId: result.user.id }, env.JWT_SECRET, { expiresIn: '24h' });
      const verifyUrl = `${String(env.FRONTEND_URL).replace(/\/+$/, '')}/auth/verify-email?token=${encodeURIComponent(
        verifyToken
      )}`;
      try {
        await emailService.sendVerifyEmail({
          toEmail: normalizedEmail,
          fullName: result.user.full_name,
          orgName: org.name,
          verifyUrl,
        });
      } catch (e) {
        logger.warn('email.verify_send_failed_invite_accept', {
          to: normalizedEmail,
          code: e?.code,
          statusCode: e?.statusCode,
          message: e?.message || String(e),
        });
        if (env.NODE_ENV !== 'production') {
          console.warn('[dev] Failed to send verification email (invite accept):', e?.message || e);
          console.log(`[dev] verify-email token for ${normalizedEmail}: ${verifyToken}`);
        }
      }
    }

    return res.status(200).json({
      user: { id: result.user.id, email: result.user.email, fullName: result.user.full_name, emailVerified: result.user.email_verified },
      org: { id: org.id, name: org.name, slug: org.slug },
      tokens: { accessToken: result.accessToken, refreshToken: result.refreshToken },
    });
  } catch (err) {
    return next(err);
  }
}

async function billing(req, res, next) {
  try {
    if (!req.user?.orgId) {
      return res.status(200).json({
        subscription: null,
        usageMonthToDate: { total_requests: 0, total_tokens: 0, total_cost_usd: 0 },
        requiresOrgSetup: true,
      });
    }
    const orgId = String(req.user.orgId);

    const subResp = await db.universalPool.query(
      `SELECT s.id, s.status, s.billing_cycle, s.current_period_start, s.current_period_end, s.trial_end,
              p.slug AS plan_slug, p.name AS plan_name, p.max_members, p.max_projects, p.ai_requests_per_day
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.org_id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [orgId]
    );
    const subscription = subResp.rows[0] || null;

    const usageResp = await db.universalPool.query(
      `SELECT
         COALESCE(SUM(total_requests), 0)::int AS total_requests,
         COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
         COALESCE(SUM(total_cost_usd), 0)::numeric AS total_cost_usd
       FROM ai_usage_daily
       WHERE org_id = $1
         AND date >= date_trunc('month', CURRENT_DATE)
         AND date < (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')`,
      [orgId]
    );

    return res.status(200).json({
      subscription,
      usageMonthToDate: usageResp.rows[0],
    });
  } catch (err) {
    return next(err);
  }
}

async function billingPlans(req, res, next) {
  try {
    if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });

    const plans = await listActivePlans();
    let coupons = [];
    try {
      coupons = await listPublicCouponsDb();
    } catch {
      coupons = [];
    }
    return res.status(200).json({
      plans,
      coupons,
    });
  } catch (err) {
    return next(err);
  }
}

async function validateBillingCoupon(req, res, next) {
  try {
    return res.status(410).json({
      error: 'Deprecated endpoint. Use POST /api/v1/org/billing/apply-coupon instead.',
      deprecated: true,
      replacement: '/api/v1/org/billing/apply-coupon',
    });
  } catch (err) {
    return next(err);
  }
}

async function billingApplyCoupon(req, res, next) {
  try {
    if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });

    const parsed = billingApplyCouponSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });

    const planSlug = String(parsed.data.planSlug || '').trim().toLowerCase();
    const billingCycle = String(parsed.data.billingCycle || 'monthly').trim().toLowerCase();
    const couponCode = normalizeCouponCodeDb(parsed.data.couponCode);

    const plan = await getActivePlanBySlug(planSlug);
    if (!plan) return res.status(400).json({ error: `Invalid plan: ${planSlug || '<empty>'}` });

    const baseAmount = resolveBaseAmountForPlan(plan, billingCycle);

    let coupon = null;
    if (couponCode) {
      const couponResult = await validateCouponForPlanDb(couponCode, plan.slug);
      if (!couponResult.valid) {
        return res.status(400).json({ valid: false, error: couponResult.reason || 'Invalid coupon' });
      }
      coupon = couponResult.coupon;
    }

    const pricing = computeDiscountedAmount(baseAmount, coupon);

    return res.status(200).json({
      ok: true,
      plan: { id: plan.id, slug: plan.slug, name: plan.name },
      billingCycle,
      coupon,
      pricing: {
        baseAmount: pricing.baseAmount,
        discountAmount: pricing.discountAmount,
        finalAmount: pricing.finalAmount,
        currency: 'USD',
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function billingCreateSubscription(req, res, next) {
  try {
    if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const parsed = billingCreateSubscriptionSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });

    const orgId = String(req.user.orgId);
    const planSlug = String(parsed.data.planSlug || '').trim().toLowerCase();
    const billingCycle = String(parsed.data.billingCycle || 'monthly').trim().toLowerCase();
    const provider = String(parsed.data.provider || 'mock').trim().toLowerCase();
    const couponCode = normalizeCouponCodeDb(parsed.data.couponCode);

    const plan = await getActivePlanBySlug(planSlug);
    if (!plan) return res.status(400).json({ error: `Invalid plan: ${planSlug || '<empty>'}` });
    if (String(plan.slug) === 'free') {
      return res.status(400).json({ error: 'Free plan does not require subscription creation.' });
    }

    const baseAmount = resolveBaseAmountForPlan(plan, billingCycle);

    const created = await db.transaction(db.universalPool, async (client) => {
      let coupon = null;
      let couponId = null;

      if (couponCode) {
        const couponResult = await validateCouponForPlanDb(couponCode, plan.slug, { client });
        if (!couponResult.valid) {
          throw Object.assign(new Error(couponResult.reason || 'Invalid coupon'), { statusCode: 400 });
        }
        coupon = couponResult.coupon;
        couponId = couponResult.couponRow?.id || null;
      }

      const pricing = computeDiscountedAmount(baseAmount, coupon);
      const requiresPayment = pricing.finalAmount > 0;
      const status = requiresPayment ? 'pending' : 'active';
      const periodEndInterval = billingCycle === 'yearly' ? '1 year' : '1 month';

      // Cancel any prior active/pending subscriptions.
      await client.query(
        "UPDATE subscriptions SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), updated_at = NOW() WHERE org_id = $1 AND status <> 'cancelled'",
        [orgId]
      );

      const tenantId = await getTenantIdForOrg(client, orgId);

      const subResp = await client.query(
        `INSERT INTO subscriptions (
           tenant_id, org_id, plan_id, billing_cycle, status,
           provider, provider_subscription_id,
           coupon_id, base_amount, discount_amount, final_amount, currency,
           current_period_start, current_period_end
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, NULL,
           $7, $8, $9, $10, 'USD',
           $11, $12
         )
         RETURNING id, status, billing_cycle, base_amount, discount_amount, final_amount, currency, created_at`,
        [
          tenantId,
          orgId,
          plan.id,
          billingCycle,
          status,
          provider,
          couponId,
          pricing.baseAmount,
          pricing.discountAmount,
          pricing.finalAmount,
          status === 'active' ? new Date() : null,
          status === 'active' ? null : null,
        ]
      );
      const subscription = subResp.rows[0];

      // Create a payment record even for 0.00 flows (helps audit and consistent UI state).
      const providerTransactionId = uuidv4();
      const payStatus = requiresPayment ? 'pending' : 'succeeded';

      const payResp = await client.query(
        `INSERT INTO payments (
           org_id, subscription_id, provider, provider_transaction_id,
           payment_status, amount, currency, metadata, paid_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, 'USD', $7,
           $8
         )
         RETURNING id, provider, provider_transaction_id, payment_status, amount, currency`,
        [
          orgId,
          subscription.id,
          provider,
          providerTransactionId,
          payStatus,
          pricing.finalAmount,
          JSON.stringify({ planSlug: plan.slug, billingCycle, couponCode: coupon?.code || null }),
          payStatus === 'succeeded' ? new Date() : null,
        ]
      );
      const payment = payResp.rows[0];

      if (!requiresPayment) {
        // Activate immediately (and update org plan) for 100% discounts.
        await client.query(
          `UPDATE subscriptions
           SET current_period_start = NOW(),
               current_period_end = (NOW() + INTERVAL '${periodEndInterval}'),
               updated_at = NOW()
           WHERE id = $1`,
          [subscription.id]
        );

        if (couponId) {
          await client.query(
            `UPDATE coupons
             SET redeemed_count = redeemed_count + 1,
                 updated_at = NOW()
             WHERE id = $1
               AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)`,
            [couponId]
          );
        }

        await client.query(
          "UPDATE organizations SET plan_id = $1, plan_status = 'active', trial_ends_at = NULL, updated_at = NOW() WHERE id = $2",
          [plan.id, orgId]
        );
      }

      return {
        plan: { id: plan.id, slug: plan.slug, name: plan.name },
        coupon,
        pricing: { ...pricing, currency: 'USD' },
        requiresPayment,
        subscription,
        payment,
      };
    });

    return res.status(200).json({ ok: true, ...created });
  } catch (err) {
    if (err?.code === '42P01') {
      err.statusCode = err.statusCode || 503;
      err.publicMessage =
        err.publicMessage ||
        'Billing schema not initialized. Apply backend/api-gateway/init.sql PART 1 to the database in UNIVERSAL_DATABASE_URL (Neon), then run: backend/api-gateway -> npm run init:universal-db';
    }
    return next(err);
  }
}

async function billingConfirmPayment(req, res, next) {
  try {
    if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const parsed = billingConfirmPaymentSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });

    const orgId = String(req.user.orgId);
    const provider = String(parsed.data.provider || 'mock').trim().toLowerCase();
    const providerTransactionId = String(parsed.data.providerTransactionId || '').trim();
    const paymentStatus = String(parsed.data.paymentStatus || 'succeeded').trim().toLowerCase();

    const result = await db.transaction(db.universalPool, async (client) => {
      const payResp = await client.query(
        `SELECT id, subscription_id, payment_status, amount, currency
         FROM payments
         WHERE org_id = $1 AND provider = $2 AND provider_transaction_id = $3
         ORDER BY created_at DESC
         LIMIT 1`,
        [orgId, provider, providerTransactionId]
      );
      const payment = payResp.rows[0];
      if (!payment) throw Object.assign(new Error('Payment not found'), { statusCode: 404 });

      const paidAt = paymentStatus === 'succeeded' ? new Date() : null;
      const updatedPaymentResp = await client.query(
        `UPDATE payments
         SET payment_status = $1,
             updated_at = NOW(),
             paid_at = COALESCE(paid_at, $2)
         WHERE id = $3
         RETURNING id, subscription_id, provider, provider_transaction_id, payment_status, amount, currency, paid_at`,
        [paymentStatus, paidAt, payment.id]
      );
      const updatedPayment = updatedPaymentResp.rows[0];

      const subResp = await client.query(
        `SELECT s.id, s.plan_id, s.billing_cycle, s.status, s.coupon_id
         FROM subscriptions s
         WHERE s.id = $1 AND s.org_id = $2
         LIMIT 1`,
        [updatedPayment.subscription_id, orgId]
      );
      const subscription = subResp.rows[0];
      if (!subscription) throw Object.assign(new Error('Subscription not found'), { statusCode: 404 });

      if (paymentStatus !== 'succeeded') {
        await client.query(
          "UPDATE subscriptions SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), updated_at = NOW() WHERE id = $1",
          [subscription.id]
        );
        return { payment: updatedPayment, subscription: { ...subscription, status: 'cancelled' }, activated: false };
      }

      const periodEndInterval = String(subscription.billing_cycle) === 'yearly' ? '1 year' : '1 month';
      const activatedSubResp = await client.query(
        `UPDATE subscriptions
         SET status = 'active',
             current_period_start = NOW(),
             current_period_end = (NOW() + INTERVAL '${periodEndInterval}'),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, status, billing_cycle, current_period_start, current_period_end, final_amount, currency, coupon_id, plan_id`,
        [subscription.id]
      );
      const activatedSubscription = activatedSubResp.rows[0];

      await client.query(
        "UPDATE organizations SET plan_id = $1, plan_status = 'active', trial_ends_at = NULL, updated_at = NOW() WHERE id = $2",
        [activatedSubscription.plan_id, orgId]
      );

      if (activatedSubscription.coupon_id) {
        await client.query(
          `UPDATE coupons
           SET redeemed_count = redeemed_count + 1,
               updated_at = NOW()
           WHERE id = $1
             AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)`,
          [activatedSubscription.coupon_id]
        );
      }

      return { payment: updatedPayment, subscription: activatedSubscription, activated: true };
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    if (err?.code === '42P01') {
      err.statusCode = err.statusCode || 503;
      err.publicMessage =
        err.publicMessage ||
        'Billing schema not initialized. Apply backend/api-gateway/init.sql PART 1 to the database in UNIVERSAL_DATABASE_URL (Neon), then run: backend/api-gateway -> npm run init:universal-db';
    }
    return next(err);
  }
}

async function billingCheckout(req, res, next) {
  try {
    return res.status(410).json({
      error: 'Deprecated endpoint. Use POST /api/v1/org/billing/create-subscription instead.',
      deprecated: true,
      replacement: '/api/v1/org/billing/create-subscription',
    });
  } catch (err) {
    return next(err);
  }
}

async function billingConfirm(req, res, next) {
  try {
    return res.status(410).json({
      error: 'Deprecated endpoint. Use POST /api/v1/org/billing/confirm-payment instead.',
      deprecated: true,
      replacement: '/api/v1/org/billing/confirm-payment',
    });
  } catch (err) {
    return next(err);
  }
}

async function dbStatus(req, res, next) {
  try {
    if (!req.user?.orgId) return res.status(400).json({ error: 'Missing orgId in token' });
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const orgResp = await db.universalPool.query(
      'SELECT db_provisioned, db_connection_string, neon_branch_id FROM organizations WHERE id = $1',
      [String(req.user.orgId)]
    );
    const row = orgResp.rows[0];
    if (!row) return res.status(404).json({ error: 'Organization not found' });

    const provider = env.TENANT_DB_PROVISIONING_MODE;
    const provisioned = Boolean(row.db_provisioned);
    const projectId = provider === 'neon' ? (row.neon_branch_id ? String(row.neon_branch_id) : null) : null;
    const connectionMode = row.db_connection_string ? 'manual-connection' : provider === 'neon' ? 'neon-auto' : 'unknown';
    const connectionStringMasked = row.db_connection_string ? maskConnectionString(String(row.db_connection_string)) : null;

    let connected = false;
    if (row.db_connection_string) {
      try {
        const pool = poolFromConnectionString(String(row.db_connection_string));
        await pool.query('SELECT 1');
        connected = true;
        await pool.end();
      } catch {
        connected = false;
      }
    }

    const status = connected ? 'connected' : provisioned ? 'provisioned' : 'not_provisioned';

    return res.status(200).json({
      provider,
      connectionMode,
      status,
      provisioned,
      connected,
      projectId,
      connectionStringMasked,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createOrg,
  provisionDb,
  getCurrentOrg,
  emailStatus,
  deleteOrg,
  updateSettings,
  listMembers,
  inviteMember,
  removeMember,
  listInvitations,
  acceptInvitation,
  billing,
  billingPlans,
  validateBillingCoupon,
  billingApplyCoupon,
  billingCreateSubscription,
  billingConfirmPayment,
  billingCheckout,
  billingConfirm,
  dbStatus,
};
