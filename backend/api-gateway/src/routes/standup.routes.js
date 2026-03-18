const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const standupController = require('../controllers/standup.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/', standupController.listStandups);
router.post('/', standupController.createStandup);

module.exports = router;
