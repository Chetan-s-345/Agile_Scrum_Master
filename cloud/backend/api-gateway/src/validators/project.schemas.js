const { z } = require('zod');

const uuidSchema = z.string().uuid();

const listProjectsQuerySchema = z.object({
  status: z.string().min(1).optional(),
});

const slugSchema = z
  .string()
  .min(1)
  .transform((v) => String(v).trim().toLowerCase())
  .refine((v) => /^[a-z0-9-]+$/.test(v), { message: 'slug may contain letters, numbers, and hyphens' })
  .refine((v) => !v.startsWith('-') && !v.endsWith('-') && !v.includes('--'), {
    message: 'slug cannot start/end with a hyphen or contain consecutive hyphens',
  });

const createProjectSchema = z.object({
  name: z.string().min(1),
  slug: slugSchema.optional(),
  description: z.string().optional(),
  techStack: z.array(z.string().min(1)).default([]),
  jiraProjectKey: z.string().min(1).optional(),
  githubRepo: z.string().min(1).optional(),
  ownerId: uuidSchema.optional(),
});

const updateProjectSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.string().min(1).optional(),
    techStack: z.array(z.string().min(1)).optional(),
    targetEndDate: z.string().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const addMemberSchema = z.object({
  memberId: uuidSchema,
  role: z.string().min(1).default('developer'),
});

const createEpicSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.string().min(1).optional(),
  startDate: z.string().min(1).optional(),
  targetDate: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
});

const projectIdParamsSchema = z.object({
  projectId: uuidSchema,
});

const epicProjectIdParamsSchema = projectIdParamsSchema;

const removeMemberParamsSchema = z.object({
  projectId: uuidSchema,
  memberId: uuidSchema,
});

module.exports = {
  uuidSchema,
  listProjectsQuerySchema,
  createProjectSchema,
  updateProjectSchema,
  addMemberSchema,
  createEpicSchema,
  projectIdParamsSchema,
  epicProjectIdParamsSchema,
  removeMemberParamsSchema,
};
