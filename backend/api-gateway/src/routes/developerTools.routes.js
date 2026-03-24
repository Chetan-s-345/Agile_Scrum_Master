const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const controller = require('../controllers/developerTools.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/', controller.getSummary);
router.post('/api-keys', controller.createApiKey);
router.post('/api-keys/:apiKeyId/revoke', controller.revokeApiKey);
router.post('/webhooks', controller.createWebhook);
router.patch('/webhooks/:webhookId', controller.updateWebhook);
router.delete('/webhooks/:webhookId', controller.deleteWebhook);

module.exports = router;
