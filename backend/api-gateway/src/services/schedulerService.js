const { getQueues, pingRedis } = require('./queue.service');
const { logger } = require('../middleware/logger');

let _scheduled = false;

async function ensureRepeatableJobs() {
  if (_scheduled) return;
  _scheduled = true;

  const redisOk = await pingRedis();
  if (!redisOk) {
    logger.warn('Redis unavailable; scheduler jobs not started');
    return;
  }

  const queues = getQueues();

  // Daily at 09:00 UTC
  await queues.sprintMonitoring.add(
    'daily-snapshot',
    {},
    {
      jobId: 'sprint-monitoring:daily-snapshot',
      repeat: { cron: '0 9 * * *', tz: 'UTC' },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  logger.info('Scheduler repeatable jobs ensured');
}

module.exports = {
  ensureRepeatableJobs,
};
