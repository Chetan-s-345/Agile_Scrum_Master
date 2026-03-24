const crypto = require('node:crypto');

function requireOrgDb(req) {
  if (!req.orgDb) throw Object.assign(new Error('Org DB not attached'), { statusCode: 500 });
  return req.orgDb;
}

function requireRole(req, allowed) {
  const role = String(req.user?.role || '');
  if (!allowed.includes(role)) throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

async function getActorMemberId(orgPool, userId) {
  const resp = await orgPool.query('SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1', [String(userId || '')]);
  return resp.rows[0]?.id || null;
}

function maskApiKey(prefix, last4) {
  return `${prefix}••••••••${last4}`;
}

function newApiKey() {
  const key = `sk-${crypto.randomBytes(24).toString('hex')}`;
  return { key, prefix: key.slice(0, 3), last4: key.slice(-4) };
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

class DeveloperToolsService {
  async summary(req) {
    const orgPool = requireOrgDb(req);
    const canRevealKey = ['owner', 'admin'].includes(String(req.user?.role || ''));

    const [keysResp, hooksResp, todayResp, monthResp] = await Promise.all([
      orgPool.query(
        `SELECT id, name, key_prefix, key_last4, key_value, is_active, created_at, last_used_at, revoked_at
         FROM developer_api_keys
         ORDER BY created_at DESC`
      ),
      orgPool.query(
        `SELECT id, endpoint_url, events, is_active, last_triggered_at, created_at
         FROM developer_webhooks
         ORDER BY created_at DESC`
      ),
      orgPool.query(
        `SELECT COUNT(*)::int AS count
         FROM org_audit_log
         WHERE created_at >= date_trunc('day', NOW())`
      ),
      orgPool.query(
        `SELECT COUNT(*)::int AS count
         FROM org_audit_log
         WHERE created_at >= date_trunc('month', NOW())`
      ),
    ]);

    const apiKeys = keysResp.rows.map((row) => ({
      id: row.id,
      name: row.name,
      keyMasked: maskApiKey(String(row.key_prefix || 'sk-'), String(row.key_last4 || '')),
      fullKey: canRevealKey ? String(row.key_value || '') : '',
      canRevealKey,
      createdAt: toIso(row.created_at),
      lastUsedAt: toIso(row.last_used_at),
      status: row.is_active ? 'active' : 'revoked',
      revokedAt: toIso(row.revoked_at),
    }));

    const webhooks = hooksResp.rows.map((row) => ({
      id: row.id,
      endpointUrl: row.endpoint_url,
      events: Array.isArray(row.events) ? row.events : [],
      active: Boolean(row.is_active),
      lastTriggeredAt: toIso(row.last_triggered_at),
      createdAt: toIso(row.created_at),
    }));

    const requestsToday = Number(todayResp.rows[0]?.count || 0);
    const requestsMonth = Number(monthResp.rows[0]?.count || 0);

    return {
      apiKeys,
      webhooks,
      usage: {
        requestsToday,
        requestsMonth,
        rateLimit: 10000,
        quotaUsedPct: Math.min(100, Math.round((requestsMonth / 100000) * 100)),
      },
    };
  }

  async createApiKey(req, { name }) {
    requireRole(req, ['owner', 'admin']);
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    const generated = newApiKey();

    const inserted = await orgPool.query(
      `INSERT INTO developer_api_keys (name, key_prefix, key_last4, key_value, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, key_prefix, key_last4, key_value, created_at, is_active, last_used_at, revoked_at`,
      [String(name), generated.prefix, generated.last4, generated.key, actorMemberId]
    );

    const row = inserted.rows[0];
    return {
      id: row.id,
      name: row.name,
      keyMasked: maskApiKey(String(row.key_prefix), String(row.key_last4)),
      fullKey: String(row.key_value),
      createdAt: toIso(row.created_at),
      lastUsedAt: toIso(row.last_used_at),
      status: row.is_active ? 'active' : 'revoked',
      revokedAt: toIso(row.revoked_at),
    };
  }

  async revokeApiKey(req, apiKeyId) {
    requireRole(req, ['owner', 'admin']);
    const orgPool = requireOrgDb(req);

    const updated = await orgPool.query(
      `UPDATE developer_api_keys
       SET is_active = FALSE, revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [String(apiKeyId)]
    );

    if (!updated.rows[0]) throw Object.assign(new Error('API key not found'), { statusCode: 404 });
    return { ok: true };
  }

  async createWebhook(req, { endpointUrl, events }) {
    requireRole(req, ['owner', 'admin']);
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);

    const inserted = await orgPool.query(
      `INSERT INTO developer_webhooks (endpoint_url, events, created_by)
       VALUES ($1,$2,$3)
       RETURNING id, endpoint_url, events, is_active, last_triggered_at, created_at`,
      [String(endpointUrl), events || [], actorMemberId]
    );

    const row = inserted.rows[0];
    return {
      id: row.id,
      endpointUrl: row.endpoint_url,
      events: Array.isArray(row.events) ? row.events : [],
      active: Boolean(row.is_active),
      lastTriggeredAt: toIso(row.last_triggered_at),
      createdAt: toIso(row.created_at),
    };
  }

  async updateWebhook(req, webhookId, { endpointUrl, events, active }) {
    requireRole(req, ['owner', 'admin']);
    const orgPool = requireOrgDb(req);

    const sets = [];
    const params = [];

    if (endpointUrl !== undefined) {
      params.push(String(endpointUrl));
      sets.push(`endpoint_url = $${params.length}`);
    }
    if (events !== undefined) {
      params.push(Array.isArray(events) ? events : []);
      sets.push(`events = $${params.length}`);
    }
    if (active !== undefined) {
      params.push(Boolean(active));
      sets.push(`is_active = $${params.length}`);
    }

    params.push(String(webhookId));
    const updated = await orgPool.query(
      `UPDATE developer_webhooks
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING id, endpoint_url, events, is_active, last_triggered_at, created_at`,
      params
    );

    const row = updated.rows[0];
    if (!row) throw Object.assign(new Error('Webhook not found'), { statusCode: 404 });

    return {
      id: row.id,
      endpointUrl: row.endpoint_url,
      events: Array.isArray(row.events) ? row.events : [],
      active: Boolean(row.is_active),
      lastTriggeredAt: toIso(row.last_triggered_at),
      createdAt: toIso(row.created_at),
    };
  }

  async deleteWebhook(req, webhookId) {
    requireRole(req, ['owner', 'admin']);
    const orgPool = requireOrgDb(req);

    const deleted = await orgPool.query('DELETE FROM developer_webhooks WHERE id = $1 RETURNING id', [String(webhookId)]);
    if (!deleted.rows[0]) throw Object.assign(new Error('Webhook not found'), { statusCode: 404 });
    return { ok: true };
  }
}

const developerToolsService = new DeveloperToolsService();

module.exports = { developerToolsService };
