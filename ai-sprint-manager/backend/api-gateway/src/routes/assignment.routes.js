const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const assignmentController = require('../controllers/assignment.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.post('/assign', assignmentController.assign);
router.post('/assign-explicit', assignmentController.assignExplicit);
router.post('/assign-bulk', assignmentController.assignBulk);
router.post('/reassign', assignmentController.reassign);
router.get('/suggest/:taskId', assignmentController.suggest);
router.get('/failures', assignmentController.failures);
router.get('/log', assignmentController.log);

module.exports = router;
