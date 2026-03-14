const express = require('express');

const webhookController = require('../controllers/webhook.controller');

const router = express.Router();

router.post('/github', webhookController.githubWebhook);

module.exports = router;
