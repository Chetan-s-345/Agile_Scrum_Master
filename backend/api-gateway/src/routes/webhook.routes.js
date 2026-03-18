const express = require('express');

const webhookController = require('../controllers/webhook.controller');

const router = express.Router();

router.post('/github', express.raw({ type: 'application/json' }), webhookController.githubWebhook);

module.exports = router;
