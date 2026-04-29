const { Worker } = require('bullmq');

const { getRedis } = require('../services/queue.service');
const { logger } = require('../middleware/logger');
const { processPostMeetingJob } = require('../jobs/post-meeting.job');

let _worker = null;

function startPostMeetingWorker() {
  if (_worker) return _worker;

  const connection = getRedis();
  _worker = new Worker(
    'post-meeting',
    async (job) => {
      const meetingId = String(job.data?.meetingId || '').trim();

      if (!meetingId) {
        throw Object.assign(new Error('Missing meetingId for post-meeting job'), {
          code: 'POST_MEETING_JOB_INVALID_PAYLOAD',
        });
      }

      const orgId = String(job.data?.orgId || '').trim() || null;
      return processPostMeetingJob({ orgId, meetingId });
    },
    { connection, concurrency: 2 }
  );

  _worker.on('active', (job) => {
    logger.info(
      { jobId: job.id, jobName: job.name, instance: process.env.RENDER_INSTANCE_NAME },
      `[${process.env.RENDER_INSTANCE_NAME}] Processing post-meeting job`
    );
  });

  _worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, result }, 'post-meeting job completed');
  });

  _worker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id, payload: job?.data }, 'post-meeting job failed');
  });

  return _worker;
}

module.exports = {
  startPostMeetingWorker,
};
