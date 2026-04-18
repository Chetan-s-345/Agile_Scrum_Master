const express = require('express');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const goalController = require('../controllers/goal.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/', goalController.listGoals);
router.post('/', goalController.createGoal);
router.get('/:id', goalController.getGoal);
router.patch('/:id', goalController.updateGoal);
router.delete('/:id', goalController.deleteGoal);
router.post('/:id/assignees', goalController.addGoalAssignees);
router.post('/:id/repos', goalController.addGoalRepos);
router.post('/:id/sprints', goalController.addGoalSprints);

module.exports = router;
