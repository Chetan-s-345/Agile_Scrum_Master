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

  // Every 5 minutes: retry any tasks that failed outbound Jira sync.
  await queues.jiraSync.add(
    'retry-unsynced-tasks',
    { limitPerOrg: 25 },
    {
      jobId: 'jira-sync:retry-unsynced-tasks',
      repeat: { cron: '*/5 * * * *', tz: 'UTC' },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  // Weekly on Monday 09:00 UTC: compute PR review summary metrics.
  await queues.prMetrics.add(
    'weekly-pr-review-summary',
    {},
    {
      jobId: 'pr-metrics:weekly-pr-review-summary',
      repeat: { cron: '0 9 * * 1', tz: 'UTC' },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  logger.info('Scheduler repeatable jobs ensured');
}

module.exports = {
  ensureRepeatableJobs,
};
