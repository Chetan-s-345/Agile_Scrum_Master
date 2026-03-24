const express = require('express');
const { z } = require('zod');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const { jiraService } = require('../services/jiraService');
const { githubService } = require('../services/githubService');
const { getQueues, pingRedis, getRedis } = require('../services/queue.service');
const githubRoutes = require('./github');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

function requireRole(req, allowed) {
  const role = String(req.user?.role || '');
  return allowed.includes(role);
}

router.post('/jira/connect', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const schema = z.object({
      baseUrl: z.string().min(1),
      email: z.string().email(),
      apiToken: z.string().min(1),
      projectKey: z.string().min(1),
      boardId: z.union([z.string().min(1), z.number().int().positive()]).optional(),
      storyPointsField: z.string().min(1).optional(),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });

    const result = await jiraService.connect(
      {
        baseUrl: parsed.data.baseUrl,
        email: parsed.data.email,
        apiToken: parsed.data.apiToken,
        projectKey: parsed.data.projectKey,
        boardId: parsed.data.boardId,
        storyPointsField: parsed.data.storyPointsField,
      },
      req.orgDb
    );

    // Kick off an initial full sync in the background (best-effort).
    let initialSync = { queued: false };
    try {
      const redisOk = await pingRedis({ timeoutMs: 750 });
      if (redisOk) {
        const queues = getQueues();
        const job = await queues.jiraSync.add(
          'full-sync',
          { orgId: req.user?.orgId || null },
          { removeOnComplete: true, removeOnFail: 500 }
        );
        initialSync = { queued: true, jobId: job.id };
      }
    } catch {
      initialSync = { queued: false };
    }

    return res.status(200).json({ ...result, initialSync });
  } catch (err) {
    return next(err);
  }
});

router.post('/jira/sync', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const schema = z.object({
      projectKey: z.string().min(1).optional(),
      boardId: z.union([z.string().min(1), z.number().int().positive()]).optional(),
      mode: z.enum(['incremental', 'full_30d', 'active_sprint']).optional(),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });

    const redisOk = await pingRedis();
    if (!redisOk) {
      return res.status(503).json({
        error: 'Redis unavailable',
        hint: 'Start Redis, or set ENABLE_WORKERS=false and ENABLE_SCHEDULER=false for local development.',
      });
    }

    const queues = getQueues();
    const orgId = req.user?.orgId || null;

    const projectKey = parsed.data.projectKey ? String(parsed.data.projectKey) : null;
    const boardId = parsed.data.boardId != null ? String(parsed.data.boardId) : '';
    const mode = parsed.data.mode || 'incremental';

    const job = projectKey
      ? await queues.jiraSync.add(
          'project-sync',
          { orgId: orgId ? String(orgId) : null, projectKey, boardId, mode },
          { removeOnComplete: true, removeOnFail: 500 }
        )
      : await queues.jiraSync.add(
          'full-sync',
          { orgId: orgId ? String(orgId) : null },
          { removeOnComplete: true, removeOnFail: 500 }
        );

    return res.status(202).json({ queued: true, jobId: job.id });
  } catch (err) {
    return next(err);
  }
});

router.get('/jira/sync-status', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const orgId = req.user?.orgId || null;
    if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

    const redisOk = await pingRedis({ timeoutMs: 500 });
    if (!redisOk) {
      return res.status(200).json({ syncing: false, processed: 0, total: 0, message: 'idle' });
    }

    const redis = getRedis();
    const raw = await redis.get(`jira-sync:status:${String(orgId)}`);
    if (!raw) return res.status(200).json({ syncing: false, processed: 0, total: 0, message: 'idle' });

    let parsed = null;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      parsed = null;
    }

    return res.status(200).json(parsed || { syncing: false, processed: 0, total: 0, message: 'idle' });
  } catch (err) {
    return next(err);
  }
});

router.get('/jira/projects', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const [projects, boards] = await Promise.all([
      jiraService.listProjects(orgPool),
      jiraService.listBoards(orgPool),
    ]);

    let syncStates = [];
    try {
      const stateResp = await orgPool.query(
        `SELECT project_key, board_id, last_synced_at, last_mode, last_status, last_error, updated_at
         FROM jira_project_sync_state`
      );
      syncStates = stateResp.rows || [];
    } catch {
      syncStates = [];
    }

    let schedule = null;
    try {
      const schedResp = await orgPool.query(
        `SELECT enabled, project_key, board_id, mode, time_of_day::text AS time, timezone, updated_at
         FROM jira_sync_schedule
         ORDER BY updated_at DESC
         LIMIT 1`
      );
      const r = schedResp.rows[0] || null;
      schedule = r
        ? {
            enabled: Boolean(r.enabled),
            projectKey: r.project_key || null,
            boardId: r.board_id || null,
            mode: r.mode || 'incremental',
            time: r.time || '09:00',
            timezone: r.timezone || 'UTC',
            updatedAt: r.updated_at || null,
          }
        : null;
    } catch {
      schedule = null;
    }

    const lastSyncedByProject = new Map();
    for (const s of syncStates) {
      const pk = String(s.project_key || '');
      if (!pk) continue;
      const ts = s.last_synced_at ? new Date(s.last_synced_at).getTime() : null;
      if (!Number.isFinite(ts)) continue;
      const prev = lastSyncedByProject.get(pk);
      if (!prev || ts > prev.ts) {
        lastSyncedByProject.set(pk, {
          ts,
          lastSyncedAt: s.last_synced_at,
          lastMode: s.last_mode || null,
          lastStatus: s.last_status || null,
          lastError: s.last_error || null,
        });
      }
    }

    const enrichedProjects = projects.map((p) => {
      const agg = lastSyncedByProject.get(String(p.key)) || null;
      return {
        ...p,
        lastSyncedAt: agg?.lastSyncedAt || null,
        lastMode: agg?.lastMode || null,
        lastStatus: agg?.lastStatus || null,
        lastError: agg?.lastError || null,
      };
    });

    return res.status(200).json({ projects: enrichedProjects, boards, syncStates, schedule });
  } catch (err) {
    return next(err);
  }
});

router.patch('/jira/sync-schedule', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const schema = z
      .object({
        enabled: z.boolean(),
        time: z.string().regex(/^\d{2}:\d{2}$/),
        timezone: z.string().min(1).optional(),
        projectKey: z.string().min(1).optional(),
        boardId: z.union([z.string().min(1), z.number().int().positive()]).optional(),
        mode: z.enum(['incremental', 'full_30d', 'active_sprint']).optional(),
      })
      .superRefine((v, ctx) => {
        if (v.enabled && !v.projectKey) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'projectKey is required when enabled', path: ['projectKey'] });
        }
      });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });

    const enabled = Boolean(parsed.data.enabled);
    const time = String(parsed.data.time);
    const timezone = parsed.data.timezone ? String(parsed.data.timezone) : 'UTC';
    const projectKey = parsed.data.projectKey ? String(parsed.data.projectKey) : null;
    const boardId = parsed.data.boardId != null ? String(parsed.data.boardId) : null;
    const mode = parsed.data.mode || 'incremental';

    await orgPool.query(
      `INSERT INTO jira_sync_schedule (enabled, project_key, board_id, mode, time_of_day, timezone, updated_at)
       VALUES ($1,$2,$3,$4,$5::time,$6,NOW())`,
      [enabled, projectKey, boardId, mode, time, timezone]
    );

    const orgId = req.user?.orgId || null;
    if (!orgId) return res.status(200).json({ ok: true, scheduled: false });

    const redisOk = await pingRedis({ timeoutMs: 750 });
    if (!redisOk) {
      return res.status(200).json({ ok: true, scheduled: false, warning: 'redis_unavailable' });
    }

    const queues = getQueues();
    const jobId = `jira-sync:daily:${String(orgId)}`;

    // Remove any existing daily job for this org (best-effort).
    try {
      const reps = await queues.jiraSync.getRepeatableJobs();
      const matches = reps.filter((j) => j.id === jobId);
      for (const m of matches) {
        await queues.jiraSync.removeRepeatableByKey(m.key);
      }
    } catch {
      // ignore
    }

    if (enabled) {
      const [hh, mm] = time.split(':').map((x) => Number(x));
      const cron = `${mm} ${hh} * * *`;

      await queues.jiraSync.add(
        'project-sync',
        {
          orgId: String(orgId),
          projectKey: projectKey || null,
          boardId: boardId || '',
          mode,
          scheduled: true,
        },
        {
          jobId,
          repeat: { cron, tz: timezone },
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
    }

    return res.status(200).json({ ok: true, enabled, time, timezone, projectKey, boardId, mode });
  } catch (err) {
    return next(err);
  }
});

router.get('/jira/status', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const status = await jiraService.getStatus(req.orgDb);
    return res.status(200).json(status);
  } catch (err) {
    return next(err);
  }
});

router.get('/jira/webhook-logs', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    let lastEvent = null;
    try {
      const resp = await orgPool.query(
        `SELECT
           id,
           event_type,
           created_at,
           processed,
           processing_error,
           payload->'issue'->>'key' AS issue_key
         FROM webhook_events
         WHERE source = 'jira'
         ORDER BY created_at DESC
         LIMIT 1`
      );

      const row = resp.rows[0] || null;
      if (row) {
        lastEvent = {
          id: row.id,
          eventType: row.event_type,
          receivedAt: row.created_at,
          status: row.processed && !row.processing_error ? 'success' : 'failed',
          issueKey: row.issue_key || null,
          error: row.processing_error || null,
        };
      }
    } catch {
      lastEvent = null;
    }

    let failures = [];
    try {
      const failResp = await orgPool.query(
        `SELECT
           id,
           event_type,
           created_at,
           processing_error,
           payload->'issue'->>'key' AS issue_key
         FROM webhook_events
         WHERE source = 'jira'
           AND processing_error IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 5`
      );

      failures = failResp.rows.map((r) => ({
        id: r.id,
        eventType: r.event_type,
        receivedAt: r.created_at,
        status: 'failed',
        issueKey: r.issue_key || null,
        error: r.processing_error || 'Unknown error',
      }));
    } catch {
      failures = [];
    }

    return res.status(200).json({ lastEvent, failures });
  } catch (err) {
    return next(err);
  }
});

router.post('/jira/webhook-logs/:eventId/retry', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const eventId = String(req.params.eventId || '').trim();
    if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

    const redisOk = await pingRedis({ timeoutMs: 750 });
    if (!redisOk) {
      return res.status(503).json({ error: 'Redis unavailable', hint: 'Enable Redis to retry webhook processing.' });
    }

    const resp = await orgPool.query(
      `SELECT id, source, processed
       FROM webhook_events
       WHERE id = $1
       LIMIT 1`,
      [eventId]
    );

    const row = resp.rows[0] || null;
    if (!row) return res.status(404).json({ error: 'Webhook event not found' });
    if (row.source !== 'jira') return res.status(400).json({ error: 'Only Jira webhook events can be retried' });

    await orgPool.query(
      `UPDATE webhook_events
       SET processed = FALSE,
           processed_at = NULL,
           processing_error = NULL
       WHERE id = $1`,
      [eventId]
    );

    const queues = getQueues();
    const job = await queues.webhookProcessing.add(
      'process-webhook-event',
      { orgId: req.user?.orgId || null, webhookEventId: eventId },
      { removeOnComplete: true, removeOnFail: 500 }
    );

    return res.status(202).json({ queued: true, jobId: job.id });
  } catch (err) {
    return next(err);
  }
});

router.get('/jira/sync-logs', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const limitRaw = String(req.query.limit || '20');
    const limit = Math.max(1, Math.min(100, Number(limitRaw) || 20));

    const status = String(req.query.status || '').trim();
    const action = String(req.query.action || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    const where = [];
    const params = [];

    // Only show outbound rows (where action/task info is most useful).
    where.push(`direction = 'outbound'`);

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    if (action) {
      params.push(action);
      where.push(`action = $${params.length}`);
    }

    if (from) {
      params.push(from);
      where.push(`started_at >= $${params.length}::timestamp`);
    }

    if (to) {
      params.push(to);
      where.push(`started_at <= $${params.length}::timestamp`);
    }

    params.push(limit);

    const resp = await orgPool.query(
      `SELECT
         id,
         started_at,
         action,
         task_id,
         jira_issue_key,
         status,
         error_message,
         request_payload,
         response_payload
       FROM jira_sync_log
       WHERE ${where.join(' AND ')}
       ORDER BY started_at DESC
       LIMIT $${params.length}`,
      params
    );

    const items = resp.rows.map((r) => ({
      id: r.id,
      timestamp: r.started_at,
      action: r.action || null,
      taskId: r.task_id || null,
      jiraIssueKey: r.jira_issue_key || null,
      status: String(r.status || '').toLowerCase() === 'failed' ? 'failed' : 'success',
      errorMessage: r.error_message || null,
      requestPayload: r.request_payload ?? null,
      responsePayload: r.response_payload ?? null,
    }));

    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
});

router.post('/jira/retry-sync', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const schema = z.object({
      taskIds: z.array(z.string().uuid()).max(50).optional(),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });

    const redisOk = await pingRedis({ timeoutMs: 750 });
    if (!redisOk) {
      return res.status(503).json({
        error: 'Redis unavailable',
        hint: 'Start Redis, or set ENABLE_WORKERS=false and ENABLE_SCHEDULER=false for local development.',
      });
    }

    const orgId = req.user?.orgId || null;
    if (!orgId) return res.status(401).json({ error: 'Unauthorized' });

    const taskIds = parsed.data.taskIds || [];
    const queues = getQueues();

    if (!taskIds.length) {
      const job = await queues.jiraSync.add(
        'retry-unsynced-tasks',
        { orgId: String(orgId), limitPerOrg: 25 },
        { removeOnComplete: true, removeOnFail: 500 }
      );
      return res.status(202).json({ queued: true, mode: 'retry_unsynced', jobId: job.id });
    }

    const jobIds = [];
    for (const taskId of taskIds) {
      const job = await queues.jiraSync.add(
        'jira-task-sync',
        { orgId: String(orgId), taskId: String(taskId), action: 'sync_snapshot' },
        { removeOnComplete: true, removeOnFail: 500 }
      );
      jobIds.push(job.id);
    }

    return res.status(202).json({ queued: true, mode: 'tasks', count: taskIds.length, jobIds });
  } catch (err) {
    return next(err);
  }
});

router.use('/github', githubRoutes);

router.get('/status', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const [jira, github] = await Promise.all([jiraService.getStatus(req.orgDb), githubService.getStatus(req.orgDb)]);
    return res.status(200).json({ jira, github, slack: { connected: false } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
