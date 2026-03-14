const { z } = require('zod');

const uuidSchema = z.string().uuid();

const assignSchema = z.object({
  taskId: uuidSchema,
  sprintId: uuidSchema,
  techTags: z.array(z.string().min(1)).default([]),
  storyPoints: z.number().int().min(0).max(500),
  priority: z.string().min(1).optional(),
});

const assignBulkSchema = z.object({
  tasks: z
    .array(
      z.object({
        taskId: uuidSchema,
        sprintId: uuidSchema.optional(),
        techTags: z.array(z.string().min(1)).default([]),
        storyPoints: z.number().int().min(0).max(500),
        priority: z.string().min(1).optional(),
      })
    )
    .min(1),
});

const reassignSchema = z.object({
  taskId: uuidSchema,
  reason: z.string().min(1).optional(),
});

const suggestParamsSchema = z.object({
  taskId: uuidSchema,
});

const listLogQuerySchema = z.object({
  developerId: uuidSchema.optional(),
  sprintId: uuidSchema.optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  limit: z
    .preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().int().min(1).max(200).optional())
    .optional(),
  offset: z
    .preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().int().min(0).max(100000).optional())
    .optional(),
});

module.exports = {
  assignSchema,
  assignBulkSchema,
  reassignSchema,
  suggestParamsSchema,
  listLogQuerySchema,
};
