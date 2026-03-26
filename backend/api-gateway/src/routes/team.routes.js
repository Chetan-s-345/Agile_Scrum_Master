const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const controller = require('../controllers/team.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/intelligence', controller.getIntelligence);
router.patch('/intelligence/skills/:developerId', controller.updateSkillMatrix);
router.post('/intelligence/rebalance', controller.generateRebalance);
router.post('/intelligence/rebalance/apply', controller.applyRebalance);

router.get('/', controller.listTeams);
router.post('/', controller.createTeam);
router.delete('/:teamId', controller.deleteTeam);

router.get('/:teamId/members', controller.listMembers);
router.post('/:teamId/members', controller.addMember);
router.delete('/:teamId/members/:memberId', controller.removeMember);

router.post('/:teamId/join-requests', controller.createJoinRequest);
router.get('/:teamId/join-requests', controller.listJoinRequests);
router.patch('/join-requests/:requestId', controller.reviewJoinRequest);

router.get('/:teamId/scores', controller.listScores);
router.patch('/:teamId/scores/:memberId', controller.updateScore);

module.exports = router;
