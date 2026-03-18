const { z } = require('zod');

const uuidSchema = z.string().uuid();

const listSprintsQuerySchema = z.object({
  projectId: uuidSchema.optional(),
  status: z.string().min(1).optional(),
});

const createSprintSchema = z.object({
  projectId: uuidSchema,
  name: z.string().min(1),
  goal: z.string().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

const planSprintSchema = z.object({
  projectId: uuidSchema,
  maxPoints: z.number().int().min(1).max(5000).optional(),
});

const sprintIdParamsSchema = z.object({
  sprintId: uuidSchema,
});

module.exports = {
  uuidSchema,
  listSprintsQuerySchema,
  createSprintSchema,
  planSprintSchema,
  sprintIdParamsSchema,
};
