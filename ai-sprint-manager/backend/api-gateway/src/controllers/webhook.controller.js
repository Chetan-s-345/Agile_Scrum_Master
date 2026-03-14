const crypto = require('crypto');

const { env } = require('../config/env');
const { db } = require('../config/database');
const { logger } = require('../middleware/logger');

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

  try {
    await orgPool.query(
      `INSERT INTO webhook_events (source, event_type, payload)
       VALUES ($1, $2, $3)`,
      ['github', eventType, payload ?? {}]
    );
  } catch (err) {
    logger.error({ err, orgId, eventType }, 'webhook.github.insert_failed');
    return res.status(500).json({ error: 'Failed to store webhook event' });
  }

  return res.status(202).json({ ok: true, delivery: delivery || null });
}

module.exports = {
  githubWebhook,
};
