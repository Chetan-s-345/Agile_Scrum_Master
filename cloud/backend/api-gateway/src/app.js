const path = require('node:path');
const http = require('node:http');

// Always load backend/api-gateway/.env regardless of launch cwd.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
// Keep cwd .env as a secondary source (without overriding existing keys).
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Server } = require('socket.io');

const { env } = require('./config/env');
const { logger, morganStream } = require('./middleware/logger');
const { errorHandler } = require('./middleware/errorHandler');
const { ensureRepeatableJobs } = require('./services/schedulerService');
const { startSprintMonitoringWorker } = require('./workers/sprintMonitoring.worker');
const { startJiraSyncWorker } = require('./workers/jiraSync.worker');
const { startWebhookProcessingWorker } = require('./workers/webhookProcessing.worker');
const { startPrMetricsWorker } = require('./workers/prMetrics.worker');
const { startWebhookRetryWorker } = require('./jobs/webhookRetryWorker');
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
const meetingsRoutes = require('./routes/meetings.routes');
const goalRoutes = require('./routes/goal.routes');
const developerToolsRoutes = require('./routes/developerTools.routes');
const spaceRoutes = require('./routes/space.routes');
const githubActivityRoutes = require('./routes/githubActivity.routes');
const teamRoutes = require('./routes/team.routes');
const metricsRoutes = require('./routes/metrics');
const adminWebhookRoutes = require('./routes/adminWebhook.routes');
const agentRoutes = require('./routes/agents.routes');
const agentCommandRoutes = require('./routes/agent.routes');
const sprintAutopilotRoutes = require('./routes/sprintAutopilot.routes');
const { startAllAgents } = require('../server/agents');
const { setIo, projectRoom } = require('./realtime/io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_URL,
    credentials: true,
  },
});

setIo(io);

io.on('connection', (socket) => {
  socket.on('project:join', (projectPayload) => {
    const raw = typeof projectPayload === 'object' && projectPayload !== null ? projectPayload.projectId : projectPayload;
    const id = String(raw || '').trim();
    if (!id) return;
    socket.join(projectRoom(id));
  });

  socket.on('project:leave', (projectPayload) => {
    const raw = typeof projectPayload === 'object' && projectPayload !== null ? projectPayload.projectId : projectPayload;
    const id = String(raw || '').trim();
    if (!id) return;
    socket.leave(projectRoom(id));
  });
});

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);

// Important: webhook signature verification requires access to the raw request body.
// So we skip global JSON parsing for /api/v1/webhooks and parse bodies per webhook route.
const jsonParser = express.json({ limit: '1mb' });
app.use((req, res, next) => {
  if (req.path.startsWith('/api/v1/webhooks')) return next();
  return jsonParser(req, res, next);
});
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
app.use('/api/v1/meetings', meetingsRoutes);
app.use('/api/v1/goals', goalRoutes);
app.use('/api/v1/developer-tools', developerToolsRoutes);
app.use('/api/v1/spaces', spaceRoutes);
app.use('/api/v1/github', githubActivityRoutes);
app.use('/api/v1/teams', teamRoutes);
app.use('/api/v1/metrics', metricsRoutes);
app.use('/api/v1/admin/webhooks', adminWebhookRoutes);
app.use('/api/v1/agents', agentRoutes);
app.use('/api/v1/agent', agentCommandRoutes);
app.use('/api/v1/sprint-autopilot', sprintAutopilotRoutes);

// Ensure unmatched routes return JSON (prevents upstream non-JSON errors in the Next.js proxy).
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl,
    method: req.method,
  });
});

app.use(errorHandler);

server.listen(env.PORT, () => {
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

    try {
      startWebhookProcessingWorker();
    } catch (err) {
      logger.error({ err }, 'Failed to start webhook processing worker');
    }

    try {
      startPrMetricsWorker();
    } catch (err) {
      logger.error({ err }, 'Failed to start pr metrics worker');
    }

    try {
      startWebhookRetryWorker();
    } catch (err) {
      logger.error({ err }, 'Failed to start webhook retry worker');
    }

    try {
      startAllAgents();
    } catch (err) {
      logger.error({ err }, 'Failed to start autonomous monitoring agents');
    }
  }
})().catch((err) => {
  logger.error({ err }, 'Failed to initialize background services');
});

module.exports = { app, server, io };


