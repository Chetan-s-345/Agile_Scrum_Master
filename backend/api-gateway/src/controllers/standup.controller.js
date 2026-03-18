const { createStandupSchema, listStandupsQuerySchema } = require('../validators/standup.schemas');
const { standupService } = require('../services/standup.service');

function validationError(res, parsed) {
  const flat = parsed.error.flatten();
  const firstField = Object.entries(flat.fieldErrors || {}).find(([, msgs]) => Array.isArray(msgs) && msgs.length);
  const firstMessage =
    (Array.isArray(flat.formErrors) && flat.formErrors[0]) ||
    (firstField ? `${firstField[0]}: ${firstField[1][0]}` : null) ||
    'Validation error';

  return res.status(400).json({ error: firstMessage, details: flat });
}

async function createStandup(req, res, next) {
  try {
    const parsed = createStandupSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const item = await standupService.create(req, parsed.data);
    return res.status(201).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function listStandups(req, res, next) {
  try {
    const parsed = listStandupsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return validationError(res, parsed);

    const items = await standupService.list(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createStandup,
  listStandups,
};
