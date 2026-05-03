const axios = require('axios');

function safe(value) {
  return String(value || '').trim();
}

function getInngestEventEndpoint() {
  const devUrl = safe(process.env.INNGEST_DEV_URL);
  if (devUrl) return devUrl;

  const explicit = safe(process.env.INNGEST_EVENT_URL);
  if (explicit) return explicit;

  const key = safe(process.env.INNGEST_EVENT_KEY);
  if (key) {
    return `https://inn.gs/e/${encodeURIComponent(key)}`;
  }

  const useLocalDev = safe(process.env.INNGEST_LOCAL_DEV).toLowerCase() === 'true';
  if (useLocalDev) return 'http://127.0.0.1:8288/e/local';

  if (safe(process.env.NODE_ENV).toLowerCase() !== 'production') {
    return 'http://127.0.0.1:8288/e/local';
  }

  return '';
}

async function sendInngestEvent(name, data) {
  const endpoint = getInngestEventEndpoint();
  if (!endpoint) return { sent: false, reason: 'missing_event_endpoint' };

  try {
    await axios.post(endpoint, [{ name, data }], { timeout: 3000 });
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      reason: 'dispatch_failed',
      detail: String(err?.response?.data?.message || err?.message || 'Failed to send Inngest event'),
    };
  }
}

module.exports = {
  sendInngestEvent,
  getInngestEventEndpoint,
};
