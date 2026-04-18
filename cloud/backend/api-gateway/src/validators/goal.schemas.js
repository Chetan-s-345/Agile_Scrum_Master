const { z } = require('zod');

const uuidSchema = z.string().uuid();

const listGoalsQuerySchema = z.object({
  status: z.enum(['planned', 'in_progress', 'completed']).optional(),
  quarter: z.string().min(1).optional(),
  assigneeId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
  mine: z.coerce.boolean().optional(),
});

const createGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['planned', 'in_progress', 'completed']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  quarter: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  dueDate: z.string().min(1).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  projectId: uuidSchema.optional(),
  keyResults: z.array(z.string().min(1)).optional(),
  assigneeIds: z.array(uuidSchema).optional(),
  sprintIds: z.array(uuidSchema).optional(),
  repos: z
    .array(
      z.object({
        repoId: uuidSchema.optional(),
        fullName: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        language: z.string().optional(),
        htmlUrl: z.string().url().optional(),
        stars: z.number().int().min(0).optional(),
        private: z.boolean().optional(),
        githubRepoId: z.number().int().optional(),
      })
    )
    .optional(),
});

const updateGoalSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.enum(['planned', 'in_progress', 'completed']).optional(),
    priority: z.enum(['high', 'medium', 'low']).optional(),
    quarter: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    dueDate: z.string().min(1).optional(),
    progress: z.number().int().min(0).max(100).optional(),
    projectId: uuidSchema.optional(),
    keyResults: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const goalIdParamsSchema = z.object({
  id: uuidSchema,
});

const addGoalAssigneesSchema = z.object({
  assigneeIds: z.array(uuidSchema).min(1),
});

const addGoalSprintsSchema = z.object({
  sprintIds: z.array(uuidSchema).min(1),
});

const addGoalReposSchema = z.object({
  repos: z
    .array(
      z.object({
        repoId: uuidSchema.optional(),
        fullName: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        language: z.string().optional(),
        htmlUrl: z.string().url().optional(),
        stars: z.number().int().min(0).optional(),
        private: z.boolean().optional(),
        githubRepoId: z.number().int().optional(),
      })
    )
    .min(1),
});

module.exports = {
  uuidSchema,
  listGoalsQuerySchema,
  createGoalSchema,
  updateGoalSchema,
  goalIdParamsSchema,
  addGoalAssigneesSchema,
  addGoalSprintsSchema,
  addGoalReposSchema,
};
