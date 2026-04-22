const express = require('express');

const webhookController = require('../controllers/webhook.controller');
const jiraWebhookRoutes = require('./jiraWebhook');

const router = express.Router();

router.post('/github', express.raw({ type: 'application/json' }), webhookController.githubWebhook);
router.post('/daily', express.raw({ type: 'application/json' }), webhookController.dailyWebhook);

router.use('/jira', jiraWebhookRoutes);

module.exports = router;
