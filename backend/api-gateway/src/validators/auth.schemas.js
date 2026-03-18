const { z } = require('zod');

function emptyToUndefined(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function normalizedEmailSchema() {
  return z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().email());
}

function normalizedSlugSchema({ optional } = { optional: false }) {
  const base = z
    .preprocess(
      (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
      z.string().min(1).regex(/^[a-z0-9-]+$/, 'orgSlug may contain letters, numbers, and hyphens')
    )
    .refine((v) => !v.startsWith('-') && !v.endsWith('-') && !v.includes('--'), {
      message: 'orgSlug cannot start/end with a hyphen or contain consecutive hyphens',
    });

  if (optional) {
    return z.preprocess(emptyToUndefined, base.optional());
  }
  return base;
}

function trimmedStringSchema({ min = 1, optional } = { min: 1, optional: false }) {
  const base = z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(min));
  if (optional) return z.preprocess(emptyToUndefined, base.optional());
  return base;
}

const registerSchema = z.object({
  email: normalizedEmailSchema(),
  password: z.preprocess((v) => (typeof v === 'string' ? v : v), z.string().min(8)),
  fullName: trimmedStringSchema({ min: 1 }),
  orgName: trimmedStringSchema({ min: 1, optional: true }),
  orgSlug: normalizedSlugSchema({ optional: true }),
  planSlug: trimmedStringSchema({ min: 1, optional: true }),
  tenantDbConnectionString: trimmedStringSchema({ min: 1, optional: true }),
});

const loginSchema = z.object({
  email: normalizedEmailSchema(),
  password: z.preprocess((v) => (typeof v === 'string' ? v : v), z.string().min(1)),
  orgSlug: normalizedSlugSchema({ optional: true }),
});

const refreshSchema = z.object({
  refreshToken: trimmedStringSchema({ min: 1 }),
});

const forgotPasswordSchema = z.object({
  email: normalizedEmailSchema(),
});

const resetPasswordSchema = z.object({
  token: trimmedStringSchema({ min: 1 }),
  newPassword: z.preprocess((v) => (typeof v === 'string' ? v : v), z.string().min(8)),
});

const verifyEmailSchema = z.object({
  token: trimmedStringSchema({ min: 1 }),
});

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
};
