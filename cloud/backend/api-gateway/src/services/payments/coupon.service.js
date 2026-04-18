const { db } = require('../../config/database');

function normalizeCouponCode(code) {
  const raw = String(code || '').trim();
  if (!raw) return null;
  return raw.toUpperCase();
}

function isCouponApplicableToPlan(couponRow, planSlug) {
  const plan = String(planSlug || '').trim().toLowerCase();
  if (!plan) return false;

  const slugs = couponRow?.applicable_plan_slugs;
  if (!Array.isArray(slugs) || slugs.length === 0) return true;
  return slugs.map((s) => String(s || '').trim().toLowerCase()).includes(plan);
}

async function getActiveCouponByCode(code, { client } = {}) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;

  const runner = client || db.universalPool;
  let resp;
  try {
    resp = await runner.query(
      `SELECT id, code, description, discount_type, discount_value, applicable_plan_slugs,
              is_active, starts_at, expires_at, max_redemptions, redeemed_count
       FROM coupons
       WHERE upper(code) = $1
         AND is_active = TRUE
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [normalized]
    );
  } catch (err) {
    if (err?.code === '42P01') {
      throw Object.assign(
        new Error(
          'Billing schema not initialized (missing coupons table). Apply backend/api-gateway/init.sql PART 1 to UNIVERSAL_DATABASE_URL (Neon) by running: backend/api-gateway -> npm run init:universal-db'
        ),
        {
          statusCode: 503,
          publicMessage:
            'Billing schema not initialized. Apply backend/api-gateway/init.sql PART 1 to the database in UNIVERSAL_DATABASE_URL (Neon), then run: backend/api-gateway -> npm run init:universal-db',
          cause: err,
        }
      );
    }
    throw err;
  }

  return resp.rows[0] || null;
}

async function validateCouponForPlanDb(code, planSlug, { client } = {}) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return { valid: false, reason: 'Coupon code is required' };

  const coupon = await getActiveCouponByCode(normalized, { client });
  if (!coupon) return { valid: false, reason: 'Invalid or expired coupon' };

  if (!isCouponApplicableToPlan(coupon, planSlug)) {
    return { valid: false, reason: `Coupon not applicable to plan: ${String(planSlug || '')}` };
  }

  if (coupon.max_redemptions != null && Number(coupon.redeemed_count || 0) >= Number(coupon.max_redemptions || 0)) {
    return { valid: false, reason: 'Coupon has reached maximum redemptions' };
  }

  return {
    valid: true,
    coupon: {
      id: coupon.id,
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discount_type,
      discountValue: Number(coupon.discount_value),
      applicablePlanSlugs: coupon.applicable_plan_slugs,
    },
    couponRow: coupon,
  };
}

async function listPublicCouponsDb({ client } = {}) {
  const runner = client || db.universalPool;
  const resp = await runner.query(
    `SELECT code, description, discount_type, discount_value, applicable_plan_slugs
     FROM coupons
     WHERE is_active = TRUE
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY code ASC`
  );

  return resp.rows.map((c) => ({
    code: c.code,
    description: c.description,
    discountType: c.discount_type,
    discountValue: Number(c.discount_value),
    applicablePlanSlugs: c.applicable_plan_slugs,
  }));
}

module.exports = {
  normalizeCouponCode,
  getActiveCouponByCode,
  validateCouponForPlanDb,
  listPublicCouponsDb,
};
