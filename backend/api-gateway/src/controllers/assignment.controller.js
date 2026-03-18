const {
  assignSchema,
  assignExplicitSchema,
  assignBulkSchema,
  reassignSchema,
  suggestParamsSchema,
  listLogQuerySchema,
} = require('../validators/assignment.schemas');
const { assignmentService } = require('../services/assignment.service');

function validationError(res, parsed) {
  const flat = parsed.error.flatten();
  const firstField = Object.entries(flat.fieldErrors || {}).find(([, msgs]) => Array.isArray(msgs) && msgs.length);
  const firstMessage =
    (Array.isArray(flat.formErrors) && flat.formErrors[0]) ||
    (firstField ? `${firstField[0]}: ${firstField[1][0]}` : null) ||
    'Validation error';

  return res.status(400).json({ error: firstMessage, details: flat });
}

async function assign(req, res, next) {
  try {
    const parsed = assignSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await assignmentService.assign(req, parsed.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function assignExplicit(req, res, next) {
  try {
    const parsed = assignExplicitSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await assignmentService.assignToDeveloper(req, parsed.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function assignBulk(req, res, next) {
  try {
    const parsed = assignBulkSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const results = await assignmentService.assignBulk(req, parsed.data.tasks);
    return res.status(200).json(results);
  } catch (err) {
    return next(err);
  }
}

async function reassign(req, res, next) {
  try {
    const parsed = reassignSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await assignmentService.reassign(req, parsed.data.taskId, parsed.data.reason);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function suggest(req, res, next) {
  try {
    const parsed = suggestParamsSchema.safeParse(req.params || {});
    if (!parsed.success) return validationError(res, parsed);

    const items = await assignmentService.suggest(req, parsed.data.taskId);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function failures(req, res, next) {
  try {
    const items = await assignmentService.failures(req);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function log(req, res, next) {
  try {
    const parsed = listLogQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await assignmentService.log(req, parsed.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  assign,
  assignExplicit,
  assignBulk,
  reassign,
  suggest,
  failures,
  log,
};
