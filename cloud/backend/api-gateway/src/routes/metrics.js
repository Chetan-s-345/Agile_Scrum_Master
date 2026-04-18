const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const metricsController = require('../controllers/metricsController');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/pr-review', metricsController.getPrReviewMetrics);
router.get('/burndown', metricsController.getBurndownMetrics);
router.get('/team-load', metricsController.getTeamLoadMetrics);
router.get('/velocity', metricsController.getVelocityMetrics);
router.get('/risk-score', metricsController.getRiskScoreMetrics);

module.exports = router;
