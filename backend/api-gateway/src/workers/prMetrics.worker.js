const { Worker } = require('bullmq');

const { getRedis } = require('../services/queue.service');
const { prMetricsService } = require('../services/prMetricsService');
const { logger } = require('../middleware/logger');

let _worker = null;

function startPrMetricsWorker() {
  if (_worker) return _worker;

  const connection = getRedis();

  _worker = new Worker(
    'pr-metrics',
    async (job) => {
      if (job.name !== 'weekly-pr-review-summary') {
        logger.warn({ jobName: job.name }, 'Unknown pr-metrics job');
        return { ok: true, ignored: true, jobName: job.name };
      }

      const result = await prMetricsService.computeWeeklySummaryForAllOrgs(new Date());
      return { ok: true, orgs: result.length };
    },
    { connection, concurrency: 1 }
  );

  _worker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, 'pr-metrics job completed');
  });

  _worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id, jobName: job?.name }, 'pr-metrics job failed');
  });

  return _worker;
}

module.exports = {
  startPrMetricsWorker,
};
