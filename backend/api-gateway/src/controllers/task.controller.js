const {
  uuidSchema,
  listTasksQuerySchema,
  createTaskSchema,
  updateStatusSchema,
  updateTaskSchema,
  taskIdParamsSchema,
  addCommentSchema,
  sprintBoardParamsSchema,
  timeLogSchema,
  createSubtaskSchema,
} = require('../validators/task.schemas');
const { taskService } = require('../services/task.service');

function validationError(res, parsed) {
  const flat = parsed.error.flatten();
  const firstField = Object.entries(flat.fieldErrors || {}).find(([, msgs]) => Array.isArray(msgs) && msgs.length);
  const firstMessage =
    (Array.isArray(flat.formErrors) && flat.formErrors[0]) ||
    (firstField ? `${firstField[0]}: ${firstField[1][0]}` : null) ||
    'Validation error';

  return res.status(400).json({ error: firstMessage, details: flat });
}

async function listTasks(req, res, next) {
  try {
    const parsed = listTasksQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return validationError(res, parsed);

    const items = await taskService.list(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function getTask(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.taskId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid taskId' });

    const task = await taskService.getById(req, parsedId.data);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    return res.status(200).json({ task });
  } catch (err) {
    return next(err);
  }
}

async function listSubtasks(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.taskId);
    if (!parsedId.success) {
      return res.status(400).json({ error: 'Bad request', code: 400, detail: 'Invalid taskId' });
    }

    const items = await taskService.listSubtasks(req, parsedId.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function createSubtask(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.taskId);
    if (!parsedId.success) {
      return res.status(400).json({ error: 'Bad request', code: 400, detail: 'Invalid taskId' });
    }

    const parsed = createSubtaskSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const subtask = await taskService.createSubtask(req, parsedId.data, parsed.data);
    return res.status(201).json({ item: subtask });
  } catch (err) {
    return next(err);
  }
}

async function getTaskProgress(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.taskId);
    if (!parsedId.success) {
      return res.status(400).json({ error: 'Bad request', code: 400, detail: 'Invalid taskId' });
    }

    const progress = await taskService.getProgress(req, parsedId.data);
    if (!progress) return res.status(404).json({ error: 'Not found', code: 404, detail: 'Task not found' });

    return res.status(200).json(progress);
  } catch (err) {
    return next(err);
  }
}

async function createTask(req, res, next) {
  try {
    const parsed = createTaskSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await taskService.create(req, parsed.data);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.taskId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid taskId' });

    const parsed = updateStatusSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await taskService.updateStatus(req, parsedId.data, parsed.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function updateTask(req, res, next) {
  try {
    const parsedParams = taskIdParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return res.status(400).json({ error: 'Invalid taskId' });

    const parsed = updateTaskSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await taskService.updateTask(req, parsedParams.data.taskId, parsed.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function deleteTask(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.taskId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid taskId' });

    const hardDelete = String(req.query?.hard || '').toLowerCase() === 'true';
    const result = hardDelete
      ? await taskService.removePermanent(req, parsedId.data)
      : await taskService.cancel(req, parsedId.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function addComment(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.taskId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid taskId' });

    const parsed = addCommentSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await taskService.addComment(req, parsedId.data, parsed.data);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function listComments(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.taskId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid taskId' });

    const items = await taskService.listComments(req, parsedId.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function getBoard(req, res, next) {
  try {
    const parsedParams = sprintBoardParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return res.status(400).json({ error: 'Invalid sprintId' });

    const result = await taskService.board(req, parsedParams.data.sprintId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function addTimeLog(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.taskId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid taskId' });

    const parsed = timeLogSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await taskService.timeLog(req, parsedId.data, parsed.data);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getTask,
  listSubtasks,
  createSubtask,
  getTaskProgress,
  listTasks,
  createTask,
  updateStatus,
  updateTask,
  deleteTask,
  addComment,
  listComments,
  getBoard,
  addTimeLog,
};
