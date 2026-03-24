const { z } = require('zod');
const { githubActivityService } = require('../services/githubActivity.service');

const idSchema = z.string().min(1);

function badRequest(res, message, details) {
  return res.status(400).json({ error: message, details });
}

async function overview(req, res, next) {
  try {
    const data = await githubActivityService.overview(req);
    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}

async function commits(req, res, next) {
  try {
    const data = await githubActivityService.commits(req);
    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}

async function pullRequests(req, res, next) {
  try {
    const data = await githubActivityService.pullRequests(req);
    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}

async function issues(req, res, next) {
  try {
    const data = await githubActivityService.issues(req);
    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}

async function workflows(req, res, next) {
  try {
    const data = await githubActivityService.workflows(req);
    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}

async function branches(req, res, next) {
  try {
    const data = await githubActivityService.branches(req);
    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}

async function importIssue(req, res, next) {
  try {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) return badRequest(res, 'Invalid issue id');

    const data = await githubActivityService.importIssueAsTask(req, parsed.data);
    return res.status(201).json(data);
  } catch (err) {
    return next(err);
  }
}

async function linkTask(req, res, next) {
  try {
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) return badRequest(res, 'Invalid PR id');

    const payload = z.object({ taskId: z.string().uuid() }).safeParse(req.body || {});
    if (!payload.success) return badRequest(res, 'Validation error', payload.error.flatten());

    const data = await githubActivityService.linkPrToTask(req, parsed.data, payload.data.taskId);
    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}

async function deleteBranch(req, res, next) {
  try {
    const params = z.object({ repo: z.string().min(1), branch: z.string().min(1) }).safeParse(req.params || {});
    if (!params.success) return badRequest(res, 'Invalid params', params.error.flatten());

    const data = await githubActivityService.deleteBranch(req, params.data.repo, params.data.branch);
    return res.status(200).json(data);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  overview,
  commits,
  pullRequests,
  issues,
  workflows,
  branches,
  importIssue,
  linkTask,
  deleteBranch,
};
