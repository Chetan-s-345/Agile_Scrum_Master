const { z } = require('zod');

const uuidSchema = z.string().uuid();

const listDevelopersQuerySchema = z.object({
  role: z.string().min(1).optional(),
  available: z
    .preprocess(
      (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
      z.enum(['true', 'false']).optional()
    )
    .optional(),
  minMerit: z
    .preprocess((v) => {
      if (v === undefined || v === null) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }, z.number().min(0).max(100).optional())
    .optional(),
});

const createDeveloperSchema = z.object({
  memberId: uuidSchema,
  techStack: z.array(z.string().min(1)).default([]),
  skillLevels: z.record(z.string(), z.any()).optional(),
  primaryRole: z.string().min(1).optional(),
  maxSprintCapacity: z.number().int().min(0).max(500).optional(),
  yearsExperience: z.number().int().min(0).max(80).optional(),
  githubUsername: z.string().min(1).optional(),
});

const updateDeveloperSchema = z
  .object({
    techStack: z.array(z.string().min(1)).optional(),
    skillLevels: z.record(z.string(), z.any()).optional(),
    maxSprintCapacity: z.number().int().min(0).max(500).optional(),
    preferredTaskTypes: z.array(z.string().min(1)).optional(),
    primaryRole: z.string().min(1).optional(),
    yearsExperience: z.number().int().min(0).max(80).optional(),
    assignmentWeight: z.number().min(0).max(1).optional(),
    availabilityStatus: z.string().min(1).optional(),
    burnoutRiskFlag: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const addAvailabilitySchema = z.object({
  leaveType: z.string().min(1).optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().min(1).optional(),
});

module.exports = {
  uuidSchema,
  listDevelopersQuerySchema,
  createDeveloperSchema,
  updateDeveloperSchema,
  addAvailabilitySchema,
};
