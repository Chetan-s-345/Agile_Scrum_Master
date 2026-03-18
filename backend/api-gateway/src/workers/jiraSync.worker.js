const { Worker } = require('bullmq');

const { getRedis } = require('../services/queue.service');
const { db } = require('../config/database');
const { jiraService } = require('../services/jiraService');
const { logger } = require('../middleware/logger');

let _worker = null;

function startJiraSyncWorker() {
  if (_worker) return _worker;

  const connection = getRedis();

  _worker = new Worker(
    'jira-sync',
    async (job) => {
      if (job.name !== 'full-sync') {
        logger.warn({ jobName: job.name }, 'Unknown jira-sync job');
        return { ok: true, ignored: true, jobName: job.name };
      }

      const orgId = job.data?.orgId;
      if (!orgId) throw new Error('Missing orgId for jira full-sync');

      const orgPool = await db.getOrgPool(String(orgId));

      await jiraService.setSyncStatus(orgPool, { status: 'syncing' });

      try {
        const backlog = await jiraService.syncBacklog(orgPool);
        const sprint = await jiraService.syncActiveSprint(orgPool);

        await jiraService.setSyncStatus(orgPool, { status: 'idle' });
        return { backlog, sprint };
      } catch (err) {
        await jiraService.setSyncStatus(orgPool, { status: 'error', error: String(err?.message || err) });
        throw err;
      }
    },
    {
      connection,
      concurrency: 1,
    }
  );

  _worker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, 'jira-sync job completed');
  });

  _worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id, jobName: job?.name }, 'jira-sync job failed');
  });

  return _worker;
}

module.exports = {
  startJiraSyncWorker,
};
