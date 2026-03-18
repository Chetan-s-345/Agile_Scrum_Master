const COUPON_CATALOG = {
  'ENT-2026-SCALE-40': {
    code: 'ENT-2026-SCALE-40',
    description: '100% off Enterprise billing (full discount).',
    discountType: 'percent',
    discountValue: 100,
    applicablePlanSlugs: ['enterprise'],
    isActive: true,
  },
};

function normalizeCouponCode(code) {
  return String(code || '').trim().toUpperCase();
}

function getCouponByCode(code) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;

  const coupon = COUPON_CATALOG[normalized] || null;
  if (!coupon || !coupon.isActive) return null;
  return coupon;
}

function validateCouponForPlan(code, planSlug) {
  const coupon = getCouponByCode(code);
  if (!coupon) {
    return { valid: false, reason: 'Coupon code is invalid or expired.' };
  }

  const normalizedPlan = String(planSlug || '').trim().toLowerCase();
  if (!coupon.applicablePlanSlugs.includes(normalizedPlan)) {
    return {
      valid: false,
      reason: `Coupon is not valid for the ${normalizedPlan || 'selected'} plan.`,
    };
  }

  return {
    valid: true,
    coupon: {
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      applicablePlanSlugs: coupon.applicablePlanSlugs,
    },
  };
}

function listPublicCoupons() {
  return Object.values(COUPON_CATALOG)
    .filter((coupon) => coupon.isActive)
    .map((coupon) => ({
      code: coupon.code,
      description: coupon.description,
      applicablePlanSlugs: coupon.applicablePlanSlugs,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
    }));
}

module.exports = {
  normalizeCouponCode,
  getCouponByCode,
  validateCouponForPlan,
  listPublicCoupons,
};
