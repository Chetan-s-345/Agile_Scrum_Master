const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const projectController = require('../controllers/project.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/', projectController.listProjects);
router.post('/', projectController.createProject);
router.get('/:projectId', projectController.getProject);
router.patch('/:projectId', projectController.updateProject);
router.delete('/:projectId', projectController.deleteProject);
router.post('/:projectId/members', projectController.addMember);
router.delete('/:projectId/members/:memberId', projectController.removeMember);
router.get('/:projectId/epics', projectController.listEpics);
router.post('/:projectId/epics', projectController.createEpic);

module.exports = router;
