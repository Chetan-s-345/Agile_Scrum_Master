const { db } = require('../config/database');
const { handleJiraWebhookEvent } = require('./jiraWebhookHandlerService');
const { handleGithubWebhookEvent } = require('./githubWebhookHandler');

function toInt(value, def) {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

function safeText(value) {
  return String(value || '').trim();
}

function nextRetryDate(retryCount) {
  const mins = Math.max(1, toInt(retryCount, 1)) * 2;
  return new Date(Date.now() + mins * 60 * 1000);
}

async function listOrgIdsWithTenantDb() {
  const hasColumn = await db._orgHasColumn('db_connection_string');
  if (!hasColumn) return [];

  const resp = await db.universalPool.query(
    `SELECT id
     FROM organizations
     WHERE db_connection_string IS NOT NULL
       AND LENGTH(TRIM(db_connection_string)) > 0`
  );

  return resp.rows.map((r) => String(r.id));
}

class WebhookRetryService {
  async processWebhookRow(orgPool, row, options) {
    const force = Boolean(options?.force);
    const eventId = String(row.id);

    if (!force && row.processed) {
      return { ok: true, ignored: true, reason: 'already_processed', eventId };
    }

    try {
      let result = null;
      if (row.source === 'github') {
        result = await handleGithubWebhookEvent(orgPool, row.event_type, row.payload || {});
      } else if (row.source === 'jira') {
        result = await handleJiraWebhookEvent(orgPool, row.event_type, row.payload || {});
      } else {
        result = { ok: true, ignored: true, reason: 'unsupported_source', source: row.source };
      }

      await orgPool.query(
        `UPDATE webhook_events
         SET processed = TRUE,
             processed_at = NOW(),
             processing_error = NULL,
             next_retry_at = NULL,
             dlq = FALSE
         WHERE id = $1`,
        [eventId]
      );

      return { ok: true, eventId, result };
    } catch (err) {
      const currentRetry = Math.max(0, toInt(row.retry_count, 0));
      const maxRetries = Math.max(1, toInt(row.max_retries, 3));
      const nextRetryCount = currentRetry + 1;
      const willDlq = nextRetryCount >= maxRetries;
      const nextAt = willDlq ? null : nextRetryDate(nextRetryCount);
      const errorText = String(err?.message || err || 'webhook_processing_failed');

      await orgPool.query(
        `UPDATE webhook_events
         SET processed = FALSE,
             processed_at = NOW(),
             processing_error = $2,
             retry_count = $3,
             next_retry_at = $4,
             dlq = $5
         WHERE id = $1`,
        [eventId, errorText, nextRetryCount, nextAt, willDlq]
      );

      return {
        ok: false,
        eventId,
        error: errorText,
        retryCount: nextRetryCount,
        maxRetries,
        dlq: willDlq,
        nextRetryAt: nextAt,
      };
    }
  }

  async processWebhookEventById(orgPool, eventId, options) {
    const resp = await orgPool.query(
      `SELECT id, source, event_type, payload, processed, processed_at,
              processing_error, retry_count, max_retries, next_retry_at, dlq, created_at
       FROM webhook_events
       WHERE id = $1
       LIMIT 1`,
      [String(eventId)]
    );

    const row = resp.rows[0] || null;
    if (!row) return { ok: true, ignored: true, reason: 'event_not_found', eventId };
    return this.processWebhookRow(orgPool, row, options);
  }

  async getDueRetryEventIds(orgPool, limit) {
    const max = Math.max(1, Math.min(200, toInt(limit, 50)));
    const resp = await orgPool.query(
      `SELECT id
       FROM webhook_events
       WHERE processed = FALSE
         AND dlq = FALSE
         AND retry_count < max_retries
         AND next_retry_at IS NOT NULL
         AND next_retry_at <= NOW()
       ORDER BY next_retry_at ASC
       LIMIT $1`,
      [max]
    );

    return resp.rows.map((r) => String(r.id));
  }

  async processDueRetriesForOrg(orgPool, options) {
    const ids = await this.getDueRetryEventIds(orgPool, options?.limit || 50);
    const results = [];

    for (const id of ids) {
      const out = await this.processWebhookEventById(orgPool, id, { force: true });
      results.push(out);
    }

    return {
      total: ids.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  async processDueRetriesForAllOrgs(options) {
    const orgIds = await listOrgIdsWithTenantDb();
    const out = [];

    for (const orgId of orgIds) {
      try {
        const orgPool = await db.getOrgPool(String(orgId));
        const result = await this.processDueRetriesForOrg(orgPool, { limit: options?.limit || 50 });
        out.push({ orgId, ...result });
      } catch (err) {
        out.push({ orgId, total: 0, succeeded: 0, failed: 1, error: String(err?.message || err) });
      }
    }

    return out;
  }

  async listDlq(orgPool, filters) {
    const limit = Math.max(1, Math.min(500, toInt(filters?.limit, 100)));
    const source = safeText(filters?.source).toLowerCase();
    const eventType = safeText(filters?.eventType).toLowerCase();
    const from = safeText(filters?.from);
    const to = safeText(filters?.to);

    const where = ['dlq = TRUE'];
    const params = [];

    if (source) {
      params.push(source);
      where.push(`LOWER(source) = $${params.length}`);
    }

    if (eventType) {
      params.push(`%${eventType}%`);
      where.push(`LOWER(event_type) LIKE $${params.length}`);
    }

    if (from) {
      params.push(from);
      where.push(`created_at >= $${params.length}::timestamp`);
    }

    if (to) {
      params.push(to);
      where.push(`created_at <= $${params.length}::timestamp`);
    }

    const countResp = await orgPool.query(
      `SELECT COUNT(*)::int AS c
       FROM webhook_events
       WHERE ${where.join(' AND ')}`,
      params
    );

    params.push(limit);
    const listResp = await orgPool.query(
      `SELECT id, source, event_type, payload, processed, processed_at,
              processing_error, retry_count, max_retries, next_retry_at, dlq, created_at
       FROM webhook_events
       WHERE ${where.join(' AND ')}
       ORDER BY processed_at DESC NULLS LAST, created_at DESC
       LIMIT $${params.length}`,
      params
    );

    return {
      total: Number(countResp.rows[0]?.c || 0),
      items: listResp.rows,
    };
  }

  async retryDlqEvent(orgPool, eventId) {
    const out = await this.processWebhookEventById(orgPool, eventId, { force: true });
    return out;
  }

  async retryAllDlq(orgPool) {
    const resp = await orgPool.query(
      `SELECT id
       FROM webhook_events
       WHERE dlq = TRUE
       ORDER BY processed_at DESC NULLS LAST, created_at DESC
       LIMIT 500`
    );

    const ids = resp.rows.map((r) => String(r.id));
    const results = [];

    for (const id of ids) {
      const out = await this.processWebhookEventById(orgPool, id, { force: true });
      results.push(out);
    }

    return {
      total: ids.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }
}

const webhookRetryService = new WebhookRetryService();

module.exports = {
  WebhookRetryService,
  webhookRetryService,
};
