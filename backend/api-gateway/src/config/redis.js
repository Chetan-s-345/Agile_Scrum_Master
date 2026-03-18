const IORedis = require('ioredis');
const { env } = require('./env');

const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
});

module.exports = { redis };
