const {
  uuidSchema,
  listProjectsQuerySchema,
  createProjectSchema,
  updateProjectSchema,
  addMemberSchema,
  createEpicSchema,
  projectIdParamsSchema,
  removeMemberParamsSchema,
} = require('../validators/project.schemas');
const { projectService } = require('../services/project.service');

function validationError(res, parsed) {
  const flat = parsed.error.flatten();
  const firstField = Object.entries(flat.fieldErrors || {}).find(([, msgs]) => Array.isArray(msgs) && msgs.length);
  const firstMessage =
    (Array.isArray(flat.formErrors) && flat.formErrors[0]) ||
    (firstField ? `${firstField[0]}: ${firstField[1][0]}` : null) ||
    'Validation error';

  return res.status(400).json({ error: firstMessage, details: flat });
}

async function listProjects(req, res, next) {
  try {
    const parsed = listProjectsQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return validationError(res, parsed);

    const items = await projectService.list(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function createProject(req, res, next) {
  try {
    const parsed = createProjectSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await projectService.create(req, parsed.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function getProject(req, res, next) {
  try {
    const parsedParams = projectIdParamsSchema.safeParse(req.params || {});
    if (!parsedParams.success) return res.status(400).json({ error: 'Invalid projectId' });

    const result = await projectService.get(req, parsedParams.data.projectId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function updateProject(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.projectId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid projectId' });

    const parsed = updateProjectSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await projectService.update(req, parsedId.data, parsed.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function deleteProject(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.projectId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid projectId' });

    const result = await projectService.remove(req, parsedId.data, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function addMember(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.projectId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid projectId' });

    const parsed = addMemberSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await projectService.addMember(req, parsedId.data, parsed.data);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function removeMember(req, res, next) {
  try {
    const parsed = removeMemberParamsSchema.safeParse(req.params || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid projectId/memberId' });

    const result = await projectService.removeMember(req, parsed.data.projectId, parsed.data.memberId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function listEpics(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.projectId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid projectId' });

    const items = await projectService.listEpics(req, parsedId.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function listBacklog(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.projectId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid projectId' });

    const items = await projectService.listBacklog(req, parsedId.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function createEpic(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.projectId);
    if (!parsedId.success) return res.status(400).json({ error: 'Invalid projectId' });

    const parsed = createEpicSchema.safeParse(req.body || {});
    if (!parsed.success) return validationError(res, parsed);

    const result = await projectService.createEpic(req, parsedId.data, parsed.data);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listProjects,
  createProject,
  getProject,
  updateProject,
  deleteProject,
  addMember,
  removeMember,
  listEpics,
  listBacklog,
  createEpic,
};
