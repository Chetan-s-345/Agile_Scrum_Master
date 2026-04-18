const { env } = require('../../../config/env');

function getStripeClient() {
  if (!env.STRIPE_SECRET_KEY) {
    throw Object.assign(new Error('Stripe is not configured. Missing STRIPE_SECRET_KEY.'), { statusCode: 500 });
  }

  try {
    const Stripe = require('stripe');
    return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2025-02-24.acacia' });
  } catch {
    throw Object.assign(new Error('Stripe package is not installed in api-gateway. Run npm install stripe.'), {
      statusCode: 500,
    });
  }
}

async function createCheckoutSession(payload) {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: payload.successUrl,
    cancel_url: payload.cancelUrl,
    metadata: {
      orgId: payload.orgId,
      planSlug: payload.planSlug,
      billingCycle: payload.billingCycle,
      couponCode: payload.couponCode || '',
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(Number(payload.finalAmount) * 100),
          product_data: {
            name: `Agile Sprint Manager ${payload.planName} (${payload.billingCycle})`,
            description: payload.couponCode
              ? `Coupon applied: ${payload.couponCode}`
              : 'Plan upgrade checkout',
          },
        },
      },
    ],
  });

  if (!session?.url) {
    throw Object.assign(new Error('Failed to create Stripe checkout session.'), { statusCode: 502 });
  }

  return {
    checkoutUrl: session.url,
    providerSessionId: session.id,
    provider: 'stripe',
  };
}

module.exports = {
  createCheckoutSession,
};
