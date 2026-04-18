function toMoneyNumber(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
}

function clampMin0(value) {
  return Math.max(0, toMoneyNumber(value));
}

function computeDiscountedAmount(baseAmount, coupon) {
  const base = clampMin0(baseAmount);
  if (!coupon) {
    return {
      baseAmount: base,
      discountAmount: 0,
      finalAmount: base,
    };
  }

  const discountType = String(coupon.discountType || coupon.discount_type || '').trim().toLowerCase();
  const discountValueRaw = coupon.discountValue ?? coupon.discount_value;
  const discountValue = toMoneyNumber(discountValueRaw);

  if (discountType === 'percent') {
    const pct = Math.min(100, Math.max(0, discountValue));
    const final = clampMin0(base * (1 - pct / 100));
    return {
      baseAmount: base,
      discountAmount: clampMin0(base - final),
      finalAmount: final,
    };
  }

  if (discountType === 'fixed') {
    const final = clampMin0(base - discountValue);
    return {
      baseAmount: base,
      discountAmount: clampMin0(base - final),
      finalAmount: final,
    };
  }

  return {
    baseAmount: base,
    discountAmount: 0,
    finalAmount: base,
  };
}

module.exports = {
  computeDiscountedAmount,
  toMoneyNumber,
};
