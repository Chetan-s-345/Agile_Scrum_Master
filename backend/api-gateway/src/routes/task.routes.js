const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');

const taskController = require('../controllers/task.controller');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

router.get('/board/:sprintId', taskController.getBoard);
router.get('/', taskController.listTasks);
router.post('/', taskController.createTask);
router.get('/:taskId', taskController.getTask);
router.get('/:taskId/subtasks', taskController.listSubtasks);
router.post('/:taskId/subtasks', taskController.createSubtask);
router.get('/:taskId/progress', taskController.getTaskProgress);
router.patch('/:taskId/status', taskController.updateStatus);
router.patch('/:taskId', taskController.updateTask);
router.delete('/:taskId', taskController.deleteTask);
router.post('/:taskId/time-log', taskController.addTimeLog);
router.post('/:taskId/comments', taskController.addComment);
router.get('/:taskId/comments', taskController.listComments);

module.exports = router;
