const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const taskController = require('../controllers/task.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/', taskController.listTasks);
router.post('/', taskController.createTask);
router.patch('/:taskId/status', taskController.updateStatus);
router.patch('/:taskId', taskController.updateTask);
router.delete('/:taskId', taskController.deleteTask);
router.post('/:taskId/comments', taskController.addComment);
router.get('/:taskId/comments', taskController.listComments);

module.exports = router;
