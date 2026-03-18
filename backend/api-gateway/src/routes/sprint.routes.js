const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const sprintController = require('../controllers/sprint.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/', sprintController.listSprints);
router.post('/', sprintController.createSprint);
router.post('/:sprintId/plan', sprintController.planSprint);
router.patch('/:sprintId/start', sprintController.startSprint);
router.patch('/:sprintId/complete', sprintController.completeSprint);
router.patch('/:sprintId/archive', sprintController.archiveSprint);
router.delete('/:sprintId', sprintController.deleteSprint);
router.get('/:sprintId', sprintController.getSprint);
router.get('/:sprintId/burndown', sprintController.burndown);
router.get('/:sprintId/risk', sprintController.risk);

module.exports = router;
