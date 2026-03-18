const { z } = require('zod');

function emptyToUndefined(value) {
  if (value === undefined || value === null) return undefined;
  const v = String(value);
  return v.trim() === '' ? undefined : v;
}

function normalizeHttpUrl(value, fallback) {
  const raw = String(value || fallback || '').trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `http://${raw}`;
}

const optionalNonEmptyString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const EnvSchema = z
  .object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // Tenant DB strategy
  // - manual: user provides per-org Postgres connection string
  // - neon: API gateway provisions a Neon project per org
  TENANT_DB_PROVISIONING_MODE: z.enum(['manual', 'neon']).default('manual'),

  // Transactional email (Brevo)
  BREVO_API_KEY: optionalNonEmptyString,
  EMAIL_FROM: optionalNonEmptyString,
  EMAIL_FROM_NAME: optionalNonEmptyString,
  EMAIL_REPLY_TO: optionalNonEmptyString,

  UNIVERSAL_DATABASE_URL: z.string().min(1),

  // Neon API (required only when TENANT_DB_PROVISIONING_MODE=neon)
  NEON_API_KEY: optionalNonEmptyString,

  // Optional: legacy env vars from previous "branch per org" design.
  // They are intentionally not required anymore.
  NEON_PROJECT_ID: optionalNonEmptyString,
  NEON_BASE_BRANCH_ID: optionalNonEmptyString,
  NEON_DATABASE_NAME: optionalNonEmptyString,
  NEON_ROLE_NAME: optionalNonEmptyString,

  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  REFRESH_EXPIRES_IN: z.string().default('30d'),

  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  ENABLE_SCHEDULER: z.coerce.boolean().default(true),
  ENABLE_WORKERS: z.coerce.boolean().default(true),

  AI_SERVICE_URL: z.preprocess(
    (v) => normalizeHttpUrl(v, 'http://localhost:8000'),
    z.string().url()
  ),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  JIRA_CLIENT_ID: z.string().optional(),
  JIRA_CLIENT_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
})
  .superRefine((val, ctx) => {
    if (val.TENANT_DB_PROVISIONING_MODE !== 'neon') return;

    if (!val.NEON_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['NEON_API_KEY'], message: 'Required when TENANT_DB_PROVISIONING_MODE=neon' });
    }
  });

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

const env = parsed.data;

module.exports = { env };
