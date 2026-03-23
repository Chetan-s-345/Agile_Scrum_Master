const express = require('express');
const { z } = require('zod');

const { githubService } = require('../services/githubService');
const { listRepos, getRepo, connectRepo } = require('../controllers/githubRepoController');
const { getAutoTaskRules, saveAutoTaskRules } = require('../controllers/githubAutoTaskController');

const router = express.Router();

function requireRole(req, allowed) {
  const role = String(req.user?.role || '');
  return allowed.includes(role);
}

// Existing endpoints (moved from integration.routes.js)
router.post('/connect', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });

    const schema = z.object({
      githubOrg: z.string().min(1),
      repoName: z.string().min(1),
      accessToken: z.string().min(1),
      createIfMissing: z.boolean().optional(),
      visibility: z.enum(['public', 'private', 'internal']).optional(),
      description: z.string().max(500).optional(),
    });

    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });

    const result = await githubService.connect(
      {
        githubOrg: parsed.data.githubOrg,
        repoName: parsed.data.repoName,
        accessToken: parsed.data.accessToken,
        createIfMissing: parsed.data.createIfMissing,
        visibility: parsed.data.visibility,
        description: parsed.data.description,
        orgId: req.user?.orgId || null,
      },
      req.orgDb
    );

    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

router.get('/status', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });
    const status = await githubService.getStatus(req.orgDb);
    return res.status(200).json(status);
  } catch (err) {
    return next(err);
  }
});

// New repo discovery endpoints
router.get('/repos', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });
    return await listRepos(req, res, next);
  } catch (err) {
    return next(err);
  }
});

router.get('/repos/:owner/:repo', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });
    return await getRepo(req, res, next);
  } catch (err) {
    return next(err);
  }
});

router.post('/repos/:owner/:repo/connect', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });
    return await connectRepo(req, res, next);
  } catch (err) {
    return next(err);
  }
});

router.get('/auto-task-rules', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });
    return await getAutoTaskRules(req, res, next);
  } catch (err) {
    return next(err);
  }
});

router.post('/auto-task-rules', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });
    return await saveAutoTaskRules(req, res, next);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
