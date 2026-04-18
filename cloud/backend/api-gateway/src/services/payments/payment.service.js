const { db } = require('../../config/database');
const { env } = require('../../config/env');
const { getPaymentProvider } = require('./providers');
const { normalizeCouponCode, validateCouponForPlan, listPublicCoupons, getCouponByCode } = require('./coupon.catalog');
const { validateCouponForPlanDb } = require('./coupon.service');
const { computeDiscountedAmount } = require('./billing.logic');

function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function calculateFinalAmount(baseAmount, coupon) {
  const base = toNumber(baseAmount);
  if (!coupon) return base;

  const pricing = computeDiscountedAmount(base, coupon);
  return pricing.finalAmount;
}

async function ensureStandardPlansSeeded() {
  await db.universalPool.query(
    `INSERT INTO plans (
       name, slug, price_monthly, price_yearly,
       max_members, max_projects, max_sprints_per_mo, max_storage_gb, ai_requests_per_day,
       features, is_active
     ) VALUES
       (
         'Free', 'free', 0, 0,
         5, 2, 4, 2, 50,
         '{"auto_assign":false,"burnout_detect":false,"ai_reporter":false,"skill_gap":false}'::jsonb,
         TRUE
       ),
       (
         'Starter', 'starter', 49, 490,
         15, 10, 20, 20, 500,
         '{"auto_assign":true,"burnout_detect":false,"ai_reporter":true,"skill_gap":true}'::jsonb,
         TRUE
       ),
       (
         'Pro', 'pro', 199, 1990,
         50, 40, 80, 100, 2500,
         '{"auto_assign":true,"burnout_detect":true,"ai_reporter":true,"skill_gap":true}'::jsonb,
         TRUE
       ),
       (
         'Enterprise', 'enterprise', 999, 9990,
         500, 500, 500, 2000, 20000,
         '{"auto_assign":true,"burnout_detect":true,"ai_reporter":true,"skill_gap":true}'::jsonb,
         TRUE
       )
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       is_active = TRUE,
       updated_at = NOW()`
  );
}

async function getActivePlanBySlug(planSlug) {
  await ensureStandardPlansSeeded();

  const normalized = String(planSlug || '').trim().toLowerCase();
  if (!normalized) return null;

  const aliases = {
    starter: 'starter',
    pro: 'pro',
    enterprise: 'enterprise',
    free: 'free',
  };
  const canonical = aliases[normalized] || normalized;

  const resp = await db.universalPool.query(
    `SELECT id, name, slug, price_monthly, price_yearly, is_active
     FROM plans
     WHERE is_active = TRUE
       AND (
         lower(slug) = $1
         OR lower(name) = $1
         OR id::text = $1
       )
     LIMIT 1`,
    [canonical]
  );

  return resp.rows[0] || null;
}

async function listActivePlans() {
  await ensureStandardPlansSeeded();

  const resp = await db.universalPool.query(
    `SELECT id, name, slug, price_monthly, price_yearly, max_members, max_projects, ai_requests_per_day, features
     FROM plans
     WHERE is_active = TRUE
     ORDER BY CASE slug
       WHEN 'free' THEN 0
       WHEN 'starter' THEN 1
       WHEN 'pro' THEN 2
       WHEN 'enterprise' THEN 3
       ELSE 99
     END, name ASC`
  );

  return resp.rows;
}

function resolveBaseAmount(plan, billingCycle) {
  const listed = billingCycle === 'yearly' ? toNumber(plan.price_yearly) : toNumber(plan.price_monthly);
  if (listed > 0) return listed;

  // Enterprise is often contract-based in seed data; keep a practical fallback for checkout.
  if (String(plan.slug) === 'enterprise') {
    return billingCycle === 'yearly' ? 9990 : 999;
  }

  return listed;
}

async function createCheckoutForOrg({
  orgId,
  actorUserId,
  planSlug,
  billingCycle,
  couponCode,
  successUrl,
  cancelUrl,
}) {
  const normalizedPlanSlug = String(planSlug || '').trim().toLowerCase();
  const normalizedCycle = String(billingCycle || 'monthly').trim().toLowerCase();
  const normalizedCoupon = normalizeCouponCode(couponCode);

  if (!['monthly', 'yearly'].includes(normalizedCycle)) {
    throw Object.assign(new Error('billingCycle must be monthly or yearly'), { statusCode: 400 });
  }

  let plan = await getActivePlanBySlug(normalizedPlanSlug);

  // Graceful fallback: if plan is missing but coupon uniquely maps to a plan, infer it.
  if (!plan && normalizedCoupon) {
    const coupon = getCouponByCode(normalizedCoupon);
    const mappedPlanSlug =
      coupon && Array.isArray(coupon.applicablePlanSlugs) && coupon.applicablePlanSlugs.length === 1
        ? String(coupon.applicablePlanSlugs[0] || '').trim().toLowerCase()
        : null;
    if (mappedPlanSlug) {
      plan = await getActivePlanBySlug(mappedPlanSlug);
    }
  }

  if (!plan) {
    const availablePlans = await listActivePlans();
    const availablePaid = availablePlans
      .map((p) => String(p.slug || '').trim().toLowerCase())
      .filter((s) => s && s !== 'free');
    throw Object.assign(new Error(`Invalid plan: ${normalizedPlanSlug || '<empty>'}`), {
      statusCode: 400,
      details: {
        planSlug: normalizedPlanSlug || null,
        availablePaidPlans: availablePaid,
      },
    });
  }

  if (plan.slug === 'free') {
    throw Object.assign(
      new Error('Free plan does not require payment. Paste your tenant database URL during organization setup.'),
      { statusCode: 400 }
    );
  }

  const baseAmount = resolveBaseAmount(plan, normalizedCycle);
  if (baseAmount <= 0) {
    throw Object.assign(new Error('Selected plan is not priced for direct checkout yet.'), { statusCode: 400 });
  }

  let coupon = null;
  if (normalizedCoupon) {
    // Prefer DB-backed coupons; fall back to the static catalog.
    const dbResult = await validateCouponForPlanDb(normalizedCoupon, plan.slug).catch(() => ({ valid: false }));
    const couponResult = dbResult.valid ? dbResult : validateCouponForPlan(normalizedCoupon, plan.slug);
    if (!couponResult.valid) {
      throw Object.assign(new Error(couponResult.reason || 'Invalid coupon code'), { statusCode: 400 });
    }
    coupon = couponResult.coupon;
  }

  const finalAmount = calculateFinalAmount(baseAmount, coupon);

  const provider = getPaymentProvider(env.PAYMENT_PROVIDER);
  const checkout = await provider.createCheckoutSession({
    orgId,
    actorUserId,
    planSlug: plan.slug,
    planName: plan.name,
    billingCycle: normalizedCycle,
    couponCode: coupon?.code || null,
    baseAmount,
    finalAmount,
    successUrl,
    cancelUrl,
  });

  return {
    ...checkout,
    pricing: {
      baseAmount,
      finalAmount,
      billingCycle: normalizedCycle,
      currency: 'USD',
      coupon,
    },
  };
}

module.exports = {
  listActivePlans,
  listPublicCoupons,
  validateCouponForPlan,
  createCheckoutForOrg,
  getActivePlanBySlug,
};
