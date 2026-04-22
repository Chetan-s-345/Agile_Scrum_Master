const crypto = require('crypto');

const { env } = require('../config/env');
const { db } = require('../config/database');
const { logger } = require('../middleware/logger');
const { getQueues, pingRedis } = require('../services/queue.service');
const { handleJiraWebhookEvent } = require('../services/jiraWebhookHandlerService');
const { sendInngestEvent } = require('../services/inngestEvent.service');
const { enqueuePostMeetingJob } = require('../jobs/post-meeting.job');

function timingSafeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function computeGithubSignature256(secret, rawBody) {
  return `sha256=${crypto.createHmac('sha256', String(secret)).update(rawBody).digest('hex')}`;
}

function safeText(value) {
  return String(value || '').trim();
}

function toLabelNames(labels) {
  if (!Array.isArray(labels)) return [];
  return labels.map((l) => safeText(l?.name || l)).filter(Boolean);
}

async function resolveProjectIdByRepo(orgPool, repoFullName) {
  const repo = safeText(repoFullName).toLowerCase();
  if (!repo) return null;
  const resp = await orgPool.query(
    `SELECT id
     FROM projects
     WHERE LOWER(github_repo) = $1
     LIMIT 1`,
    [repo]
  );
  return resp.rows[0]?.id ? String(resp.rows[0].id) : null;
}

async function dispatchTaskFactoryEvents(orgPool, orgId, eventType, payload) {
  const action = safeText(payload?.action).toLowerCase();
  const repoFullName = safeText(payload?.repository?.full_name || payload?.repository?.name);
  const projectId = await resolveProjectIdByRepo(orgPool, repoFullName);
  if (!projectId) return { queued: false, reason: 'project_not_mapped' };

  if (eventType === 'issues' && action === 'opened') {
    await sendInngestEvent('github/issue.opened', {
      orgId,
      projectId,
      issueNumber: Number(payload?.issue?.number || 0),
      title: safeText(payload?.issue?.title),
      body: safeText(payload?.issue?.body),
      labels: toLabelNames(payload?.issue?.labels),
      repoFullName,
    });
    return { queued: true, name: 'github/issue.opened' };
  }

  if (eventType === 'pull_request' && action === 'opened') {
    await sendInngestEvent('github/pr.opened', {
      orgId,
      projectId,
      prNumber: Number(payload?.pull_request?.number || payload?.number || 0),
      title: safeText(payload?.pull_request?.title),
      body: safeText(payload?.pull_request?.body),
      branchName: safeText(payload?.pull_request?.head?.ref),
      repoFullName,
    });
    return { queued: true, name: 'github/pr.opened' };
  }

  const merged = Boolean(payload?.pull_request?.merged) || Boolean(payload?.pull_request?.merged_at);
  if (eventType === 'pull_request' && action === 'closed' && merged) {
    await sendInngestEvent('github/pr.merged', {
      orgId,
      projectId,
      prNumber: Number(payload?.pull_request?.number || payload?.number || 0),
      branchName: safeText(payload?.pull_request?.head?.ref),
      mergedBy: safeText(payload?.pull_request?.merged_by?.login || payload?.sender?.login),
      repoFullName,
    });
    return { queued: true, name: 'github/pr.merged' };
  }

  if (eventType === 'push') {
    await sendInngestEvent('github/push', {
      orgId,
      projectId,
      repoFullName,
      ref: safeText(payload?.ref),
      before: safeText(payload?.before),
      after: safeText(payload?.after),
      pusher: safeText(payload?.pusher?.name || payload?.sender?.login),
      commits: Array.isArray(payload?.commits)
        ? payload.commits.map((c) => ({
            id: safeText(c?.id),
            message: safeText(c?.message),
            url: safeText(c?.url),
            timestamp: safeText(c?.timestamp),
            author: safeText(c?.author?.name || c?.author?.username),
          }))
        : [],
    });
    return { queued: true, name: 'github/push' };
  }

  return { queued: false, reason: 'event_not_supported' };
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

  // Task Factory Inngest dispatch (additive, best-effort).
  try {
    await dispatchTaskFactoryEvents(orgPool, orgId, eventType, payload || {});
  } catch (err) {
    logger.warn({ err, orgId, eventType }, 'webhook.github.inngest_dispatch_failed');
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

function parseRawJsonBody(req) {
  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString('utf8');
    return text ? JSON.parse(text) : {};
  }

  if (typeof req.body === 'object' && req.body !== null) return req.body;
  return {};
}

function extractMeetingIdFromDailyPayload(payload) {
  const roomName =
    safeText(payload?.room) ||
    safeText(payload?.room_name) ||
    safeText(payload?.payload?.room) ||
    safeText(payload?.payload?.room_name) ||
    safeText(payload?.data?.room);

  if (!roomName) return null;
  return roomName.startsWith('meeting-') ? roomName.slice('meeting-'.length) : roomName;
}

async function resolveOrgIdForMeeting(meetingId) {
  const orgsResp = await db.universalPool.query(
    `SELECT id, db_connection_string
     FROM organizations
     WHERE db_connection_string IS NOT NULL`
  );

  for (const org of orgsResp.rows || []) {
    try {
      const orgId = String(org.id);
      const orgPool = await db.getOrgPool(orgId);
      const foundResp = await orgPool.query(
        `SELECT id
         FROM meeting_sessions
         WHERE id = $1
         LIMIT 1`,
        [String(meetingId)]
      );
      if (foundResp.rows.length) return orgId;
    } catch {
      // Best-effort org resolution across tenants.
    }
  }

  return null;
}

async function dailyWebhook(req, res) {
  let payload = {};
  try {
    payload = parseRawJsonBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const eventName =
    safeText(payload?.event) ||
    safeText(payload?.type) ||
    safeText(payload?.payload?.event) ||
    safeText(payload?.payload?.type);

  if (eventName !== 'meeting-ended') {
    return res.status(200).json({ ok: true, ignored: true, reason: 'unsupported_event' });
  }

  const meetingId = extractMeetingIdFromDailyPayload(payload);
  if (!meetingId) {
    return res.status(200).json({ ok: true, ignored: true, reason: 'missing_meeting_id' });
  }

  const providedOrgId = String(req.query?.orgId || req.get('x-org-id') || '').trim() || null;
  const orgId = providedOrgId || (await resolveOrgIdForMeeting(meetingId));

  try {
    await sendInngestEvent('meeting/completed', {
      orgId,
      meetingId,
      source: 'daily-webhook',
      rawEvent: eventName,
    });
  } catch (err) {
    logger.warn({ err, meetingId, orgId }, 'Failed to dispatch Daily meeting completion event to Inngest');
  }

  try {
    await enqueuePostMeetingJob({
      orgId,
      meetingId,
      source: 'daily-webhook',
    });
  } catch (err) {
    logger.warn({ err, meetingId }, 'Failed to enqueue post-meeting job from Daily webhook');
  }

  return res.status(200).json({ ok: true });
}

module.exports = {
  githubWebhook,
  jiraWebhook,
  dailyWebhook,
};
