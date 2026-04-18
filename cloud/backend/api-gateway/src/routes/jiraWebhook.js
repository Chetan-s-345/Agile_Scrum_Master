const express = require('express');

const webhookController = require('../controllers/webhook.controller');
const { jiraWebhookVerify } = require('../middleware/jiraWebhookVerify');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const router = express.Router();

// Authenticated test endpoint for dashboard UI.
router.post('/test', authMiddleware, orgDbMiddleware, express.json({ limit: '1mb' }), async (req, res) => {
	return res.status(200).json({ ok: true, kind: 'jira_webhook_test', received: req.body || null, serverTime: new Date().toISOString() });
});

// Use raw body so HMAC verification matches the upstream signature.
router.post('/', express.raw({ type: '*/*', limit: '1mb' }), jiraWebhookVerify, webhookController.jiraWebhook);

module.exports = router;
