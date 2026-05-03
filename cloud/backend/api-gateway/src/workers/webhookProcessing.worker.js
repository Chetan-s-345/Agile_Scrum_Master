const { Worker } = require('bullmq');

const { getRedis } = require('../services/queue.service');
const { db } = require('../config/database');
const { logger } = require('../middleware/logger');
const { webhookRetryService } = require('../services/webhookRetryService');

let _worker = null;

function startWebhookProcessingWorker() {
  if (_worker) return _worker;

  const connection = getRedis();

  _worker = new Worker(
    'webhook-processing',
    async (job) => {
      const orgId = job.data?.orgId;
      const webhookEventId = job.data?.webhookEventId;
      if (!orgId) throw new Error('Missing orgId for webhook processing');
      if (!webhookEventId) throw new Error('Missing webhookEventId for webhook processing');

      const orgPool = await db.getOrgPool(String(orgId));

      const resp = await orgPool.query(
        `SELECT id, source, event_type, payload, processed,
                retry_count, max_retries, next_retry_at, dlq
         FROM webhook_events
         WHERE id = $1`,
        [String(webhookEventId)]
      );

      const row = resp.rows[0];
      if (!row) return { ok: true, ignored: true, reason: 'event_not_found' };
      if (row.processed) return { ok: true, ignored: true, reason: 'already_processed' };

      row.retry_count = Number(row.retry_count || 0);
      row.max_retries = Number(row.max_retries || 3);
      row.next_retry_at = row.next_retry_at || null;
      row.dlq = Boolean(row.dlq);

      const result = await webhookRetryService.processWebhookRow(orgPool, row, { force: true });
      if (!result.ok) {
        throw Object.assign(new Error(result.error || 'webhook_processing_failed'), {
          eventId: row.id,
          retryCount: result.retryCount,
          maxRetries: result.maxRetries,
          dlq: result.dlq,
        });
      }

      return { ok: true, result };
    },
    { connection, concurrency: 1 }
  );

  _worker.on('active', (job) => {
    logger.info(
      { jobId: job.id, jobName: job.name, instance: process.env.RENDER_INSTANCE_NAME },
      `[${process.env.RENDER_INSTANCE_NAME}] Processing webhook-processing job`
    );
  });

  _worker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, 'webhook-processing job completed');
  });

  _worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id, jobName: job?.name }, 'webhook-processing job failed');
  });

  return _worker;
}

module.exports = {
  startWebhookProcessingWorker,
};
