const {
  uuidSchema,
  listSprintsQuerySchema,
  createSprintSchema,
  planSprintSchema,
  sprintIdParamsSchema,
} = require('../validators/sprint.schemas');
const { sprintService } = require('../services/sprint.service');

function validationError(res, parsed) {
  const flat = parsed.error.flatten();
  const firstField = Object.entries(flat.fieldErrors || {}).find(([, msgs]) => Array.isArray(msgs) && msgs.length);
  const firstMessage =
    (Array.isArray(flat.formErrors) && flat.formErrors[0]) ||
    (firstField ? `${firstField[0]}: ${firstField[1][0]}` : null) ||
    'Validation error';

  return res.status(400).json({ error: firstMessage, details: flat });
}

async function listSprints(req, res, next) {
  try {
    const parsed = listSprintsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return validationError(res, parsed);

    const items = await sprintService.list(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function createSprint(req, res, next) {
  try {
    const parsed = createSprintSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await sprintService.create(req, parsed.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function planSprint(req, res, next) {
  try {
    const parsedParams = sprintIdParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return res.status(400).json({ error: 'Invalid sprintId' });

    const parsed = planSprintSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await sprintService.plan(req, parsedParams.data.sprintId, parsed.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function startSprint(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.sprintId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid sprintId' });

    const result = await sprintService.start(req, parsedId.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function scheduleSprintMeetings(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.sprintId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid sprintId' });

    const result = await sprintService.scheduleMeetings(req, parsedId.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function completeSprint(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.sprintId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid sprintId' });

    const result = await sprintService.complete(req, parsedId.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function archiveSprint(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.sprintId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid sprintId' });

    const result = await sprintService.archive(req, parsedId.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function deleteSprint(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.sprintId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid sprintId' });

    const result = await sprintService.remove(req, parsedId.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getSprint(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.sprintId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid sprintId' });

    const result = await sprintService.get(req, parsedId.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function burndown(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.sprintId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid sprintId' });

    const items = await sprintService.burndown(req, parsedId.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function risk(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.sprintId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid sprintId' });

    const result = await sprintService.risk(req, parsedId.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listSprints,
  createSprint,
  planSprint,
  scheduleSprintMeetings,
  startSprint,
  completeSprint,
  archiveSprint,
  deleteSprint,
  getSprint,
  burndown,
  risk,
};
