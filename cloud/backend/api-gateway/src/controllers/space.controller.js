const { z } = require('zod');
const { spaceService } = require('../services/space.service');

const idSchema = z.string().uuid();
const renameSchema = z.object({ name: z.string().min(1).max(200) });
const archiveSchema = z.object({ archived: z.boolean() });
const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1) });

function badRequest(res, message, details) {
  return res.status(400).json({ error: message, details });
}

async function listSpaces(req, res, next) {
  try {
    const result = await spaceService.list(req);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function renameSpace(req, res, next) {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return badRequest(res, 'Invalid space id');

    const parsed = renameSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const result = await spaceService.rename(req, id.data, parsed.data.name);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function duplicateSpace(req, res, next) {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return badRequest(res, 'Invalid space id');

    const result = await spaceService.duplicate(req, id.data);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function archiveSpace(req, res, next) {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return badRequest(res, 'Invalid space id');

    const parsed = archiveSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const result = await spaceService.archive(req, id.data, parsed.data.archived);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function deleteSpace(req, res, next) {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return badRequest(res, 'Invalid space id');

    const result = await spaceService.remove(req, id.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function reorderSpaces(req, res, next) {
  try {
    const parsed = reorderSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const result = await spaceService.reorder(req, parsed.data.ids);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function setDefaultSpace(req, res, next) {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return badRequest(res, 'Invalid space id');

    const result = await spaceService.setDefault(req, id.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listSpaces,
  renameSpace,
  duplicateSpace,
  archiveSpace,
  deleteSpace,
  reorderSpaces,
  setDefaultSpace,
};
