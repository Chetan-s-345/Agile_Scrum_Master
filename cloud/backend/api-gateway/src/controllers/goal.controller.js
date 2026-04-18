const {
  listGoalsQuerySchema,
  createGoalSchema,
  updateGoalSchema,
  goalIdParamsSchema,
  addGoalAssigneesSchema,
  addGoalReposSchema,
  addGoalSprintsSchema,
} = require('../validators/goal.schemas');
const { goalService } = require('../services/goal.service');

function validationError(res, parsed) {
  const flat = parsed.error.flatten();
  const firstField = Object.entries(flat.fieldErrors || {}).find(([, msgs]) => Array.isArray(msgs) && msgs.length);
  const firstMessage =
    (Array.isArray(flat.formErrors) && flat.formErrors[0]) ||
    (firstField ? `${firstField[0]}: ${firstField[1][0]}` : null) ||
    'Validation error';

  return res.status(400).json({ error: firstMessage, details: flat });
}

async function listGoals(req, res, next) {
  try {
    const parsed = listGoalsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return validationError(res, parsed);

    const items = await goalService.list(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function getGoal(req, res, next) {
  try {
    const parsed = goalIdParamsSchema.safeParse(req.params || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid id' });

    const item = await goalService.getById(req, parsed.data.id);
    if (!item) return res.status(404).json({ error: 'Goal not found', code: 404, detail: 'Goal not found' });

    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function createGoal(req, res, next) {
  try {
    const parsed = createGoalSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await goalService.create(req, parsed.data);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function updateGoal(req, res, next) {
  try {
    const parsedId = goalIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid id' });

    const parsed = updateGoalSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await goalService.update(req, parsedId.data.id, parsed.data);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function deleteGoal(req, res, next) {
  try {
    const parsedId = goalIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid id' });

    const result = await goalService.remove(req, parsedId.data.id);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function addGoalAssignees(req, res, next) {
  try {
    const parsedId = goalIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid id' });

    const parsed = addGoalAssigneesSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await goalService.addAssignees(req, parsedId.data.id, parsed.data.assigneeIds);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function addGoalRepos(req, res, next) {
  try {
    const parsedId = goalIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid id' });

    const parsed = addGoalReposSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await goalService.addRepos(req, parsedId.data.id, parsed.data.repos);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function addGoalSprints(req, res, next) {
  try {
    const parsedId = goalIdParamsSchema.safeParse(req.params || {});
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid id' });

    const parsed = addGoalSprintsSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await goalService.addSprints(req, parsedId.data.id, parsed.data.sprintIds);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  addGoalAssignees,
  addGoalRepos,
  addGoalSprints,
};
