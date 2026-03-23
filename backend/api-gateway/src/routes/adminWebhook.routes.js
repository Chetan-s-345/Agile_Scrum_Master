const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const adminWebhookController = require('../controllers/adminWebhookController');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

function requireRole(req, allowed) {
  const role = String(req.user?.role || '');
  return allowed.includes(role);
}

router.get('/dlq', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });
    return await adminWebhookController.getDlq(req, res, next);
  } catch (err) {
    return next(err);
  }
});

router.post('/retry/:eventId', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });
    return await adminWebhookController.retryDlqEvent(req, res, next);
  } catch (err) {
    return next(err);
  }
});

router.post('/retry-all-dlq', async (req, res, next) => {
  try {
    if (!requireRole(req, ['owner', 'admin'])) return res.status(403).json({ error: 'Forbidden' });
    return await adminWebhookController.retryAllDlq(req, res, next);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
