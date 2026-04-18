const { z } = require('zod');

const uuidSchema = z.string().uuid();

const createTeamSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

const addTeamMemberSchema = z.object({
  memberId: uuidSchema,
  role: z.enum(['admin', 'developer']).default('developer'),
});

const createJoinRequestSchema = z.object({
  note: z.string().max(1000).optional(),
});

const reviewJoinRequestSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  note: z.string().max(1000).optional(),
});

const updateScoreSchema = z.object({
  score: z.number().min(0).max(100000),
  metric: z.string().min(1).max(100).default('performance'),
});

module.exports = {
  uuidSchema,
  createTeamSchema,
  addTeamMemberSchema,
  createJoinRequestSchema,
  reviewJoinRequestSchema,
  updateScoreSchema,
};
