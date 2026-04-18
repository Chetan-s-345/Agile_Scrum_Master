const crypto = require('crypto');

const { env } = require('../config/env');
const { logger } = require('./logger');

function timingSafeEqualString(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function computeHmacSha256Hex(secret, rawBody) {
  return crypto.createHmac('sha256', String(secret)).update(rawBody).digest('hex');
}

function normalizeSignature(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/^sha256=([a-f0-9]{64})$/i);
  if (m) return m[1].toLowerCase();
  if (/^[a-f0-9]{64}$/i.test(raw)) return raw.toLowerCase();
  return raw;
}

function getAllowedStrategies() {
  const s = String(env.JIRA_WEBHOOK_STRATEGY || 'both').trim();
  if (s === 'secret') return ['secret'];
  if (s === 'atlassian-token') return ['atlassian-token'];
  return ['secret', 'atlassian-token'];
}

function parseJsonBodyIfPossible(req) {
  if (!Buffer.isBuffer(req.body)) return;
  req.rawBody = req.body;

  const contentType = String(req.get('content-type') || 'application/json').toLowerCase();
  if (!contentType.includes('json')) return;

  try {
    const asText = req.body.toString('utf8');
    req.body = asText ? JSON.parse(asText) : {};
  } catch {
    req.body = {};
  }
}

function jiraWebhookVerify(req, res, next) {
  const allowed = getAllowedStrategies();

  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');

  const orgId = String(req.query?.orgId || req.get('x-org-id') || '').trim() || null;

  // Strategy: secret HMAC signature in X-Jira-Webhook-Secret
  if (allowed.includes('secret') && env.JIRA_WEBHOOK_SECRET) {
    const provided = normalizeSignature(req.get('x-jira-webhook-secret'));
    if (provided) {
      const expected = computeHmacSha256Hex(env.JIRA_WEBHOOK_SECRET, rawBody);
      if (timingSafeEqualString(provided, expected)) {
        req.jiraWebhookVerification = { strategy: 'secret' };
        logger.info({ orgId, strategy: 'secret' }, 'webhook.jira.verified');
        parseJsonBodyIfPossible(req);
        return next();
      }
    }
  }

  // Strategy: X-Atlassian-Token: no-check (Jira Cloud)
  if (allowed.includes('atlassian-token')) {
    const token = String(req.get('x-atlassian-token') || '').trim().toLowerCase();
    if (token === 'no-check') {
      req.jiraWebhookVerification = { strategy: 'atlassian-token' };
      logger.info({ orgId, strategy: 'atlassian-token' }, 'webhook.jira.verified');
      parseJsonBodyIfPossible(req);
      return next();
    }
  }

  logger.warn(
    { orgId, strategy: env.JIRA_WEBHOOK_STRATEGY || 'both' },
    'webhook.jira.unauthorized'
  );
  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { jiraWebhookVerify };
