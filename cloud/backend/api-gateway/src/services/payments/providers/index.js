const mockProvider = require('./mock.provider');
const stripeProvider = require('./stripe.provider');

function getPaymentProvider(providerName) {
  const normalized = String(providerName || 'mock').trim().toLowerCase();
  if (normalized === 'stripe') return stripeProvider;
  return mockProvider;
}

module.exports = {
  getPaymentProvider,
};
