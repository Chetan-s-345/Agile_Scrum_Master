const axios = require('axios');

function safe(value) {
  return String(value || '').trim();
}

function getInngestEventEndpoint() {
  const explicit = safe(process.env.INNGEST_EVENT_URL);
  if (explicit) return explicit;
  const key = safe(process.env.INNGEST_EVENT_KEY);
  if (!key) return '';
  return `https://inn.gs/e/${encodeURIComponent(key)}`;
}

async function sendInngestEvent(name, data) {
  const endpoint = getInngestEventEndpoint();
  if (!endpoint) return { sent: false, reason: 'missing_event_endpoint' };
  await axios.post(endpoint, [{ name, data }], { timeout: 3000 });
  return { sent: true };
}

module.exports = {
  sendInngestEvent,
  getInngestEventEndpoint,
};
