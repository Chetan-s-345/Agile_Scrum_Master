const express = require('express');
const { z } = require('zod');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const { jiraService } = require('../services/jiraService');
const { getQueues, pingRedis } = require('../services/queue.service');

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

    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

router.post('/jira/sync', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const redisOk = await pingRedis();
    if (!redisOk) {
      return res.status(503).json({
        error: 'Redis unavailable',
        hint: 'Start Redis, or set ENABLE_WORKERS=false and ENABLE_SCHEDULER=false for local development.',
      });
    }

    const queues = getQueues();
    const job = await queues.jiraSync.add(
      'full-sync',
      { orgId: req.user?.orgId || null },
      { removeOnComplete: true, removeOnFail: 500 }
    );

    return res.status(202).json({ queued: true, jobId: job.id });
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

module.exports = router;
