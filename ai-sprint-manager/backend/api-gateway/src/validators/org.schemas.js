const { z } = require('zod');

const updateSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  logo_url: z.string().url().optional(),
  notification_settings: z.unknown().optional(),
});

const listMembersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.string().min(1).default('member'),
});

const acceptInvitationSchema = z.object({
  fullName: z.string().min(1).optional(),
  password: z.string().min(8).optional(),
});

const createOrgSchema = z.object({
  orgName: z.string().min(1),
  orgSlug: z
    .string()
    .min(1)
    .transform((v) => String(v).trim().toLowerCase())
    .refine((v) => /^[a-z0-9-]+$/.test(v), { message: 'orgSlug may contain letters, numbers, and hyphens' })
    .refine((v) => !v.startsWith('-') && !v.endsWith('-') && !v.includes('--'), {
      message: 'orgSlug cannot start/end with a hyphen or contain consecutive hyphens',
    }),
  planSlug: z.string().min(1).optional(),
  tenantDbConnectionString: z.string().min(1).optional(),
});

module.exports = {
  updateSettingsSchema,
  listMembersQuerySchema,
  inviteMemberSchema,
  acceptInvitationSchema,
  createOrgSchema,
};
