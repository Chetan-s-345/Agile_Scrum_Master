const { z } = require('zod');

const uuidSchema = z.string().uuid();

const listTasksQuerySchema = z.object({
  sprintId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
  assigneeId: uuidSchema.optional(),
  status: z.string().min(1).optional(),
});

const createTaskSchema = z.object({
  sprintId: uuidSchema,
  projectId: uuidSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.string().min(1).optional(),
  priority: z.string().min(1).optional(),
  storyPoints: z.number().int().min(0).max(500),
  techTags: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.string().optional(),
  dueDate: z.string().min(1).optional(),
  backlogItemId: uuidSchema.optional(),
  autoAssign: z.boolean().default(true),
});

const updateStatusSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'in_review', 'blocked', 'done']),
});

const updateTaskSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    storyPoints: z.number().int().min(0).max(500).optional(),
    techTags: z.array(z.string().min(1)).optional(),
    priority: z.string().min(1).optional(),
    dueDate: z.string().min(1).optional(),
    acceptanceCriteria: z.string().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const taskIdParamsSchema = z.object({
  taskId: uuidSchema,
});

const addCommentSchema = z.object({
  content: z.string().min(1),
  commentType: z.string().min(1).optional(),
});

const sprintBoardParamsSchema = z.object({
  sprintId: uuidSchema,
});

const timeLogSchema = z.object({
  hours: z.number().min(0.25).max(24),
  workDate: z.string().min(1),
  description: z.string().optional(),
});

module.exports = {
  uuidSchema,
  listTasksQuerySchema,
  createTaskSchema,
  updateStatusSchema,
  updateTaskSchema,
  taskIdParamsSchema,
  addCommentSchema,
  sprintBoardParamsSchema,
  timeLogSchema,
};
