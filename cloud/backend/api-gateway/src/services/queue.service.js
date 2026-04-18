const IORedis = require('ioredis');
const { Queue } = require('bullmq');
const { env } = require('../config/env');
const { logger } = require('../middleware/logger');

let _redis = null;
let _queues = null;
let _redisErrorLogged = false;

function attachRedisErrorHandlers(redis) {
  // ioredis emits an 'error' event; without a listener Node will throw and crash.
  redis.on('error', (err) => {
    // Avoid log spam if Redis is down locally.
    if (_redisErrorLogged) return;
    _redisErrorLogged = true;
    logger.warn(
      {
        err,
        redisUrl: env.REDIS_URL,
      },
      'Redis connection error (Redis may be offline)'
    );
  });

  redis.on('ready', () => {
    _redisErrorLogged = false;
  });
}

function getRedis() {
  if (_redis) return _redis;
  _redis = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  attachRedisErrorHandlers(_redis);
  return _redis;
}

async function pingRedis({ timeoutMs = 750 } = {}) {
  const redis = getRedis();

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Redis ping timeout')), timeoutMs)
  );

  try {
    const resp = await Promise.race([redis.ping(), timeout]);
    return Boolean(resp);
  } catch {
    return false;
  }
}

function getQueues() {
  if (_queues) return _queues;
  const connection = getRedis();

  _queues = {
    sprintMonitoring: new Queue('sprint-monitoring', { connection }),
    meritRecalculation: new Queue('merit-recalculation', { connection }),
    reportGeneration: new Queue('report-generation', { connection }),
    modelRetraining: new Queue('model-retraining', { connection }),
    jiraSync: new Queue('jira-sync', { connection }),
    webhookProcessing: new Queue('webhook-processing', { connection }),
    prMetrics: new Queue('pr-metrics', { connection }),
  };

  return _queues;
}

module.exports = {
  getRedis,
  getQueues,
  pingRedis,
};
