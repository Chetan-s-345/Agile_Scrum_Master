const { Worker } = require('bullmq');

const { getRedis } = require('../services/queue.service');
const { monitoringService } = require('../services/monitoringService');
const { logger } = require('../middleware/logger');

let _worker = null;

function startSprintMonitoringWorker() {
  if (_worker) return _worker;

  const connection = getRedis();

  _worker = new Worker(
    'sprint-monitoring',
    async (job) => {
      if (job.name === 'daily-snapshot') {
        return await monitoringService.runAllActiveSprintSnapshots();
      }

      logger.warn({ jobName: job.name }, 'Unknown sprint-monitoring job');
      return { ok: true, ignored: true, jobName: job.name };
    },
    {
      connection,
      concurrency: 1,
    }
  );

  _worker.on('active', (job) => {
    logger.info(
      { jobId: job.id, jobName: job.name, instance: process.env.RENDER_INSTANCE_NAME },
      `[${process.env.RENDER_INSTANCE_NAME}] Processing sprint-monitoring job`
    );
  });

  _worker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, 'sprint-monitoring job completed');
  });

  _worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id, jobName: job?.name }, 'sprint-monitoring job failed');
  });

  return _worker;
}

module.exports = {
  startSprintMonitoringWorker,
};
