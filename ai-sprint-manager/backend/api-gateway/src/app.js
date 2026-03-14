require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { env } = require('./config/env');
const { logger, morganStream } = require('./middleware/logger');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const orgRoutes = require('./routes/org.routes');
const developerRoutes = require('./routes/developer.routes');
const projectRoutes = require('./routes/project.routes');
const sprintRoutes = require('./routes/sprint.routes');
const taskRoutes = require('./routes/task.routes');
const assignmentRoutes = require('./routes/assignment.routes');
const reportRoutes = require('./routes/report.routes');
const webhookRoutes = require('./routes/webhook.routes');

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

app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API gateway listening');
});

module.exports = { app };
