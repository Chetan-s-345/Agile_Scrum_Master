const {
  uuidSchema,
  listDevelopersQuerySchema,
  createDeveloperSchema,
  updateDeveloperSchema,
  addAvailabilitySchema,
} = require('../validators/developer.schemas');
const { developerService } = require('../services/developer.service');

function validationError(res, parsed) {
  const flat = parsed.error.flatten();
  const firstField = Object.entries(flat.fieldErrors || {}).find(([, msgs]) => Array.isArray(msgs) && msgs.length);
  const firstMessage =
    (Array.isArray(flat.formErrors) && flat.formErrors[0]) ||
    (firstField ? `${firstField[0]}: ${firstField[1][0]}` : null) ||
    'Validation error';

  return res.status(400).json({ error: firstMessage, details: flat });
}

async function listDevelopers(req, res, next) {
  try {
    const parsed = listDevelopersQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return validationError(res, parsed);

    const available =
      parsed.data.available === undefined ? undefined : parsed.data.available === 'true' ? true : false;

    const result = await developerService.list(req, {
      role: parsed.data.role,
      available,
      minMerit: parsed.data.minMerit,
    });
    return res.status(200).json({ items: result });
  } catch (err) {
    return next(err);
  }
}

async function leaderboard(req, res, next) {
  try {
    const result = await developerService.leaderboard(req);
    return res.status(200).json({ items: result });
  } catch (err) {
    return next(err);
  }
}

async function getDeveloper(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.developerId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid developerId' });

    const result = await developerService.get(req, parsedId.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function createDeveloper(req, res, next) {
  try {
    const parsed = createDeveloperSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await developerService.create(req, parsed.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function updateDeveloper(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.developerId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid developerId' });

    const parsed = updateDeveloperSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await developerService.update(req, parsedId.data, parsed.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getAvailability(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.developerId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid developerId' });

    const result = await developerService.getAvailability(req, parsedId.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function addAvailability(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.developerId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid developerId' });

    const parsed = addAvailabilitySchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await developerService.addAvailability(req, parsedId.data, parsed.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function deleteAvailability(req, res, next) {
  try {
    const parsedDev = uuidSchema.safeParse(req.params.developerId);
    if (!parsedDev.success) return res.status(400).json({ error: 'Invalid developerId' });
    const parsedAvail = uuidSchema.safeParse(req.params.availabilityId);
    if (!parsedAvail.success) return res.status(400).json({ error: 'Invalid availabilityId' });

    const result = await developerService.deleteAvailability(req, parsedDev.data, parsedAvail.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function performance(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.developerId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid developerId' });

    const result = await developerService.performance(req, parsedId.data);
    return res.status(200).json({ items: result });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listDevelopers,
  leaderboard,
  getDeveloper,
  createDeveloper,
  updateDeveloper,
  getAvailability,
  addAvailability,
  deleteAvailability,
  performance,
};
