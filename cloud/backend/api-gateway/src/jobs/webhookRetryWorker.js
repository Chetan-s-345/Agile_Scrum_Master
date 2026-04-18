const { logger } = require('../middleware/logger');
const { webhookRetryService } = require('../services/webhookRetryService');

let _timer = null;
let _running = false;

async function runWebhookRetryPass() {
  if (_running) return;
  _running = true;

  try {
    const results = await webhookRetryService.processDueRetriesForAllOrgs({ limit: 100 });
    const retried = results.reduce((acc, r) => acc + Number(r.total || 0), 0);
    const failed = results.reduce((acc, r) => acc + Number(r.failed || 0), 0);

    if (retried > 0 || failed > 0) {
      logger.info({ retried, failed, orgs: results.length }, 'webhook-retry worker pass completed');
    }
  } catch (err) {
    logger.error({ err }, 'webhook-retry worker pass failed');
  } finally {
    _running = false;
  }
}

function startWebhookRetryWorker() {
  if (_timer) return _timer;

  // Kickoff shortly after boot, then run every 60s.
  setTimeout(() => {
    void runWebhookRetryPass();
  }, 5000);

  _timer = setInterval(() => {
    void runWebhookRetryPass();
  }, 60 * 1000);

  return _timer;
}

function stopWebhookRetryWorker() {
  if (!_timer) return;
  clearInterval(_timer);
  _timer = null;
}

module.exports = {
  startWebhookRetryWorker,
  stopWebhookRetryWorker,
  runWebhookRetryPass,
};
