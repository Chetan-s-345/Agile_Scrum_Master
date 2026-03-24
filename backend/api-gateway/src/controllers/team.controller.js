const {
  uuidSchema,
  createTeamSchema,
  addTeamMemberSchema,
  createJoinRequestSchema,
  reviewJoinRequestSchema,
  updateScoreSchema,
} = require('../validators/team.schemas');
const { teamService } = require('../services/team.service');

function badRequest(res, message, details) {
  return res.status(400).json({ error: message, code: 400, detail: message, details });
}

async function listTeams(req, res, next) {
  try {
    const items = await teamService.list(req);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function createTeam(req, res, next) {
  try {
    const parsed = createTeamSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const item = await teamService.create(req, parsed.data);
    return res.status(201).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function deleteTeam(req, res, next) {
  try {
    const parsed = uuidSchema.safeParse(req.params.teamId);
    if (!parsed.success) return badRequest(res, 'Invalid teamId');

    const item = await teamService.remove(req, parsed.data);
    return res.status(200).json(item);
  } catch (err) {
    return next(err);
  }
}

async function listMembers(req, res, next) {
  try {
    const parsed = uuidSchema.safeParse(req.params.teamId);
    if (!parsed.success) return badRequest(res, 'Invalid teamId');

    const items = await teamService.members(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function addMember(req, res, next) {
  try {
    const parsedTeam = uuidSchema.safeParse(req.params.teamId);
    if (!parsedTeam.success) return badRequest(res, 'Invalid teamId');

    const parsed = addTeamMemberSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const item = await teamService.addMember(req, parsedTeam.data, parsed.data);
    return res.status(200).json(item);
  } catch (err) {
    return next(err);
  }
}

async function removeMember(req, res, next) {
  try {
    const parsedTeam = uuidSchema.safeParse(req.params.teamId);
    if (!parsedTeam.success) return badRequest(res, 'Invalid teamId');

    const parsedMember = uuidSchema.safeParse(req.params.memberId);
    if (!parsedMember.success) return badRequest(res, 'Invalid memberId');

    const item = await teamService.removeMember(req, parsedTeam.data, parsedMember.data);
    return res.status(200).json(item);
  } catch (err) {
    return next(err);
  }
}

async function createJoinRequest(req, res, next) {
  try {
    const parsedTeam = uuidSchema.safeParse(req.params.teamId);
    if (!parsedTeam.success) return badRequest(res, 'Invalid teamId');

    const parsed = createJoinRequestSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const item = await teamService.requestJoin(req, parsedTeam.data, parsed.data);
    return res.status(201).json({ item });
  } catch (err) {
    return next(err);
  }
}

async function listJoinRequests(req, res, next) {
  try {
    const parsed = uuidSchema.safeParse(req.params.teamId);
    if (!parsed.success) return badRequest(res, 'Invalid teamId');

    const items = await teamService.requests(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function reviewJoinRequest(req, res, next) {
  try {
    const parsedId = uuidSchema.safeParse(req.params.requestId);
    if (!parsedId.success) return badRequest(res, 'Invalid requestId');

    const parsed = reviewJoinRequestSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const item = await teamService.reviewRequest(req, parsedId.data, parsed.data);
    return res.status(200).json(item);
  } catch (err) {
    return next(err);
  }
}

async function listScores(req, res, next) {
  try {
    const parsed = uuidSchema.safeParse(req.params.teamId);
    if (!parsed.success) return badRequest(res, 'Invalid teamId');

    const items = await teamService.scores(req, parsed.data);
    return res.status(200).json({ items });
  } catch (err) {
    return next(err);
  }
}

async function updateScore(req, res, next) {
  try {
    const parsedTeam = uuidSchema.safeParse(req.params.teamId);
    if (!parsedTeam.success) return badRequest(res, 'Invalid teamId');

    const parsedMember = uuidSchema.safeParse(req.params.memberId);
    if (!parsedMember.success) return badRequest(res, 'Invalid memberId');

    const parsed = updateScoreSchema.safeParse(req.body || {});
    if (!parsed.success) return badRequest(res, 'Validation error', parsed.error.flatten());

    const item = await teamService.updateScore(req, parsedTeam.data, parsedMember.data, parsed.data);
    return res.status(200).json({ item });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listTeams,
  createTeam,
  deleteTeam,
  listMembers,
  addMember,
  removeMember,
  createJoinRequest,
  listJoinRequests,
  reviewJoinRequest,
  listScores,
  updateScore,
};
