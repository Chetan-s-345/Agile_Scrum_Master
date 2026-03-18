const { env } = require('../../../config/env');

async function createCheckoutSession(payload) {
  const checkoutUrl = `${String(env.FRONTEND_URL).replace(/\/+$/, '')}/settings/billing?payment=mock&plan=${encodeURIComponent(
    payload.planSlug
  )}&cycle=${encodeURIComponent(payload.billingCycle)}`;

  return {
    checkoutUrl,
    providerSessionId: `mock_${Date.now()}`,
    provider: 'mock',
  };
}

module.exports = {
  createCheckoutSession,
};
