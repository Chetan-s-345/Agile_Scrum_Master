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
  autoResolveSlugCollision: z.coerce.boolean().optional(),
  tenantDbConnectionString: z
    .string()
    .min(1)
    .refine((v) => /^postgres(ql)?:\/\//i.test(String(v || '')), {
      message: 'tenantDbConnectionString must start with postgres:// or postgresql://',
    })
    .optional(),
});

const provisionDbSchema = z
  .object({
    tenantDbConnectionString: z
      .string()
      .min(1)
      .refine((v) => /^postgres(ql)?:\/\//i.test(String(v || '')), {
        message: 'tenantDbConnectionString must start with postgres:// or postgresql://',
      })
      .optional(),
    autoProvision: z.coerce.boolean().optional(),
    neonOrgId: z
      .string()
      .min(1)
      .transform((v) => String(v).trim())
      .refine((v) => /^org-[a-z0-9-]+$/i.test(v), { message: 'neonOrgId must look like org-...' })
      .optional(),
  })
  .refine((v) => Boolean(v.tenantDbConnectionString) || Boolean(v.autoProvision), {
    message: 'Provide tenantDbConnectionString or set autoProvision=true',
  });

const billingCheckoutSchema = z.object({
  planSlug: z.string().min(1),
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  couponCode: z.string().min(1).optional(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const couponValidateSchema = z.object({
  planSlug: z.string().min(1),
  couponCode: z.string().min(1),
});

const billingConfirmSchema = z.object({
  planSlug: z.string().min(1),
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  provider: z.string().min(1).optional(),
  providerSessionId: z.string().min(1).optional(),
  couponCode: z.string().min(1).optional(),
});

const billingApplyCouponSchema = z.object({
  planSlug: z.string().min(1),
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  couponCode: z.string().min(1).optional(),
});

const billingCreateSubscriptionSchema = z.object({
  planSlug: z.string().min(1),
  billingCycle: z.enum(['monthly', 'yearly']).default('monthly'),
  couponCode: z.string().min(1).optional(),
  provider: z.enum(['mock', 'stripe']).default('mock'),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

const billingConfirmPaymentSchema = z.object({
  provider: z.enum(['mock', 'stripe']).default('mock'),
  providerTransactionId: z.string().min(1),
  paymentStatus: z.enum(['succeeded', 'failed', 'cancelled']).default('succeeded'),
});

module.exports = {
  updateSettingsSchema,
  listMembersQuerySchema,
  inviteMemberSchema,
  acceptInvitationSchema,
  createOrgSchema,
  provisionDbSchema,
  billingCheckoutSchema,
  couponValidateSchema,
  billingConfirmSchema,
  billingApplyCouponSchema,
  billingCreateSubscriptionSchema,
  billingConfirmPaymentSchema,
};
