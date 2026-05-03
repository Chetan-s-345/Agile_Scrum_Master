const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const reportController = require('../controllers/report.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/', reportController.listReports);
router.get('/:sprintId', reportController.getSprintReport);
router.get('/:sprintId/audit', reportController.getSprintAuditReport);
router.get('/:sprintId/export.csv', reportController.exportSprintReportCsv);

module.exports = router;
