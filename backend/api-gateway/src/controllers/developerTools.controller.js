const { z } = require('zod');
const { developerToolsService } = require('../services/developerTools.service');

const idSchema = z.string().uuid();
const createApiKeySchema = z.object({ name: z.string().min(1).max(140) });
const createWebhookSchema = z.object({
  endpointUrl: z.string().url().max(1200),
  events: z.array(z.string().min(1)).default([]),
});
const updateWebhookSchema = z
  .object({
    endpointUrl: z.string().url().max(1200).optional(),
    events: z.array(z.string().min(1)).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.endpointUrl !== undefined || v.events !== undefined || v.active !== undefined, {
    message: 'At least one field is required',
  });

function badRequest(res, message, details) {
  return res.status(400).json({ error: message, details });
}

async function getSummary(req, res, next) {
  try {
    const result = await developerToolsService.summary(req);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function createApiKey(req, res, next) {
  try {
    const parsed = createApiKeySchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const result = await developerToolsService.createApiKey(req, parsed.data);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function revokeApiKey(req, res, next) {
  try {
    const parsedId = idSchema.safeParse(req.params.apiKeyId);
    if (!parsedId.success) return badRequest(res, 'Invalid apiKeyId');

    const result = await developerToolsService.revokeApiKey(req, parsedId.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function createWebhook(req, res, next) {
  try {
    const parsed = createWebhookSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const result = await developerToolsService.createWebhook(req, parsed.data);
    return res.status(201).json(result);
  } catch (err) {
    return next(err);
  }
}

async function updateWebhook(req, res, next) {
  try {
    const parsedId = idSchema.safeParse(req.params.webhookId);
    if (!parsedId.success) return badRequest(res, 'Invalid webhookId');

    const parsed = updateWebhookSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const result = await developerToolsService.updateWebhook(req, parsedId.data, parsed.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function deleteWebhook(req, res, next) {
  try {
    const parsedId = idSchema.safeParse(req.params.webhookId);
    if (!parsedId.success) return badRequest(res, 'Invalid webhookId');

    const result = await developerToolsService.deleteWebhook(req, parsedId.data);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getSummary,
  createApiKey,
  revokeApiKey,
  createWebhook,
  updateWebhook,
  deleteWebhook,
};
