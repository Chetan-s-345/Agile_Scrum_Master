const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const metricsController = require('../controllers/metricsController');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/pr-review', metricsController.getPrReviewMetrics);

module.exports = router;
