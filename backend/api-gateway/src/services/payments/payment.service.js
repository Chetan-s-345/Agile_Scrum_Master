const { db } = require('../../config/database');
const { env } = require('../../config/env');
const { getPaymentProvider } = require('./providers');
const { normalizeCouponCode, validateCouponForPlan, listPublicCoupons } = require('./coupon.catalog');

function toNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function calculateFinalAmount(baseAmount, coupon) {
  const base = toNumber(baseAmount);
  if (!coupon) return base;

  if (coupon.discountType === 'percent') {
    const discounted = base * (1 - Number(coupon.discountValue || 0) / 100);
    return Math.max(0, Math.round(discounted * 100) / 100);
  }

  return base;
}

async function getActivePlanBySlug(planSlug) {
  const normalized = String(planSlug || '').trim().toLowerCase();
  if (!normalized) return null;

  const resp = await db.universalPool.query(
    `SELECT id, name, slug, price_monthly, price_yearly, is_active
     FROM plans
     WHERE slug = $1 AND is_active = TRUE
     LIMIT 1`,
    [normalized]
  );

  return resp.rows[0] || null;
}

async function listActivePlans() {
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

  if (!['monthly', 'yearly'].includes(normalizedCycle)) {
    throw Object.assign(new Error('billingCycle must be monthly or yearly'), { statusCode: 400 });
  }

  const plan = await getActivePlanBySlug(normalizedPlanSlug);
  if (!plan) throw Object.assign(new Error('Invalid plan'), { statusCode: 400 });

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

  const normalizedCoupon = normalizeCouponCode(couponCode);
  const couponResult = normalizedCoupon
    ? validateCouponForPlan(normalizedCoupon, plan.slug)
    : { valid: false };

  if (normalizedCoupon && !couponResult.valid) {
    throw Object.assign(new Error(couponResult.reason || 'Invalid coupon code'), { statusCode: 400 });
  }

  const coupon = couponResult.valid ? couponResult.coupon : null;
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
};
