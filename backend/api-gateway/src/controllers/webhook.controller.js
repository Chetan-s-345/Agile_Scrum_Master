const crypto = require('crypto');

const { env } = require('../config/env');
const { db } = require('../config/database');
const { logger } = require('../middleware/logger');
const { getQueues, pingRedis } = require('../services/queue.service');
const { handleJiraWebhookEvent } = require('../services/jiraWebhookHandlerService');

function timingSafeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function computeGithubSignature256(secret, rawBody) {
  return `sha256=${crypto.createHmac('sha256', String(secret)).update(rawBody).digest('hex')}`;
}

async function githubWebhook(req, res) {
  const orgId = String(req.query?.orgId || req.get('x-org-id') || '').trim();
  if (!orgId) {
    return res.status(400).json({ error: 'Missing orgId (provide ?orgId=... or x-org-id header)' });
  }

  const eventType = String(req.get('x-github-event') || 'github.event').trim();
  const delivery = String(req.get('x-github-delivery') || '').trim();

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
  let payload = null;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    payload = { raw: rawBody.toString('utf8') };
  }

  if (env.GITHUB_WEBHOOK_SECRET) {
    const signature = String(req.get('x-hub-signature-256') || '').trim();
    const expected = computeGithubSignature256(env.GITHUB_WEBHOOK_SECRET, rawBody);
    if (!signature || !timingSafeEqual(signature, expected)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  }

  let orgPool;
  try {
    orgPool = await db.getOrgPool(orgId);
  } catch (err) {
    logger.warn({ err, orgId }, 'webhook.github.org_pool_failed');
    return res.status(503).json({ error: 'Database unavailable' });
  }

  let insertedId = null;
  try {
    const ins = await orgPool.query(
      `INSERT INTO webhook_events (source, event_type, payload)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['github', eventType, payload ?? {}]
    );
    insertedId = ins.rows[0]?.id || null;
  } catch (err) {
    logger.error({ err, orgId, eventType }, 'webhook.github.insert_failed');
    return res.status(500).json({ error: 'Failed to store webhook event' });
  }

  // Queue async processing (best-effort). If Redis is unavailable, still accept the webhook.
  try {
    const redisOk = await pingRedis({ timeoutMs: 500 });
    if (redisOk && insertedId) {
      const queues = getQueues();
      await queues.webhookProcessing.add(
        'process-webhook-event',
        { orgId, webhookEventId: insertedId },
        { removeOnComplete: true, removeOnFail: 1000 }
      );
    }
  } catch (err) {
    logger.warn({ err, orgId, insertedId }, 'webhook.github.queue_failed');
  }

  return res.status(200).json({ ok: true, delivery: delivery || null });
}

async function jiraWebhook(req, res) {
  const orgId = String(req.query?.orgId || req.get('x-org-id') || '').trim();
  if (!orgId) {
    return res.status(400).json({ error: 'Missing orgId (provide ?orgId=... or x-org-id header)' });
  }

  const eventType = String(req.body?.webhookEvent || req.body?.eventType || 'jira.event').trim();
  const payload = req.body || {};

  let orgPool;
  try {
    orgPool = await db.getOrgPool(orgId);
  } catch (err) {
    logger.warn({ err, orgId }, 'webhook.jira.org_pool_failed');
    return res.status(503).json({ error: 'Database unavailable' });
  }

  let insertedId = null;
  try {
    const ins = await orgPool.query(
      `INSERT INTO webhook_events (source, event_type, payload)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['jira', eventType, payload]
    );
    insertedId = ins.rows[0]?.id || null;
  } catch (err) {
    logger.error({ err, orgId, eventType }, 'webhook.jira.insert_failed');
    return res.status(500).json({ error: 'Failed to store webhook event' });
  }

  // Process Jira events synchronously (best-effort) so changelog updates apply immediately.
  // Handler is idempotent, so retries/duplicates are safe.
  let handlerResult = null;
  let handled = false;
  try {
    handlerResult = await handleJiraWebhookEvent(orgPool, eventType, payload);
    handled = true;

    if (insertedId) {
      await orgPool.query(
        `UPDATE webhook_events
         SET processed = TRUE,
             processed_at = NOW(),
             processing_error = NULL
         WHERE id = $1`,
        [String(insertedId)]
      );
    }
  } catch (err) {
    logger.error({ err, orgId, eventType, insertedId }, 'webhook.jira.handler_failed');
    try {
      if (insertedId) {
        await orgPool.query(
          `UPDATE webhook_events
           SET processed = FALSE,
               processed_at = NOW(),
               processing_error = $2,
               retry_count = COALESCE(retry_count, 0) + 1,
               dlq = (COALESCE(retry_count, 0) + 1) >= COALESCE(max_retries, 3),
               next_retry_at = CASE
                 WHEN (COALESCE(retry_count, 0) + 1) >= COALESCE(max_retries, 3)
                   THEN NULL
                 ELSE NOW() + ((COALESCE(retry_count, 0) + 1) * INTERVAL '2 minutes')
               END
           WHERE id = $1`,
          [String(insertedId), String(err?.message || err)]
        );
      }
    } catch {
      // ignore
    }
  }

  // Fallback to async processing only if handler failed.
  if (!handled) {
    try {
      const redisOk = await pingRedis({ timeoutMs: 500 });
      if (redisOk && insertedId) {
        const queues = getQueues();
        await queues.webhookProcessing.add(
          'process-webhook-event',
          { orgId, webhookEventId: insertedId },
          { removeOnComplete: true, removeOnFail: 1000 }
        );
      }
    } catch (err) {
      logger.warn({ err, orgId, insertedId }, 'webhook.jira.queue_failed');
    }
  }

  return res.status(200).json({ ok: true, handled, result: handlerResult });
}

module.exports = {
  githubWebhook,
  jiraWebhook,
};
