const path = require('node:path');

// Always load backend/api-gateway/.env regardless of launch cwd.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
// Keep cwd .env as a secondary source (without overriding existing keys).
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { env } = require('./config/env');
const { logger, morganStream } = require('./middleware/logger');
const { errorHandler } = require('./middleware/errorHandler');
const { ensureRepeatableJobs } = require('./services/schedulerService');
const { startSprintMonitoringWorker } = require('./workers/sprintMonitoring.worker');
const { startJiraSyncWorker } = require('./workers/jiraSync.worker');
const { pingRedis } = require('./services/queue.service');

const authRoutes = require('./routes/auth.routes');
const orgRoutes = require('./routes/org.routes');
const developerRoutes = require('./routes/developer.routes');
const projectRoutes = require('./routes/project.routes');
const sprintRoutes = require('./routes/sprint.routes');
const taskRoutes = require('./routes/task.routes');
const assignmentRoutes = require('./routes/assignment.routes');
const reportRoutes = require('./routes/report.routes');
const webhookRoutes = require('./routes/webhook.routes');
const monitoringRoutes = require('./routes/monitoring.routes');
const integrationRoutes = require('./routes/integration.routes');
const aiRoutes = require('./routes/ai.routes');
const standupRoutes = require('./routes/standup.routes');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined', { stream: morganStream }));

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'api-gateway' });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/org', orgRoutes);
app.use('/api/v1/developers', developerRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/sprints', sprintRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/assignment', assignmentRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/monitoring', monitoringRoutes);
app.use('/api/v1/integrations', integrationRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/standup', standupRoutes);

// Ensure unmatched routes return JSON (prevents upstream non-JSON errors in the Next.js proxy).
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl,
    method: req.method,
  });
});

app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API gateway listening');
});

// Background features (queues/workers) require Redis.
(async () => {
  const needsRedis = Boolean(env.ENABLE_SCHEDULER || env.ENABLE_WORKERS);
  if (!needsRedis) return;

  const redisOk = await pingRedis({ timeoutMs: 750 });
  if (!redisOk) {
    logger.warn(
      {
        redisUrl: env.REDIS_URL,
        ENABLE_SCHEDULER: env.ENABLE_SCHEDULER,
        ENABLE_WORKERS: env.ENABLE_WORKERS,
      },
      'Redis unavailable; skipping scheduler/workers'
    );
    return;
  }

  if (env.ENABLE_SCHEDULER) {
    ensureRepeatableJobs().catch((err) => {
      logger.error({ err }, 'Failed to ensure repeatable jobs');
    });
  }

  if (env.ENABLE_WORKERS) {
    try {
      startSprintMonitoringWorker();
    } catch (err) {
      logger.error({ err }, 'Failed to start sprint monitoring worker');
    }

    try {
      startJiraSyncWorker();
    } catch (err) {
      logger.error({ err }, 'Failed to start jira sync worker');
    }
  }
})().catch((err) => {
  logger.error({ err }, 'Failed to initialize background services');
});

module.exports = { app };
