const { getQueues } = require('./queue.service');
const { logger } = require('../middleware/logger');

async function isJiraIntegrationActive(orgPool) {
  try {
    const resp = await orgPool.query('SELECT 1 FROM jira_integration WHERE is_active = TRUE LIMIT 1');
    return resp.rows.length > 0;
  } catch {
    // Table might not exist in some environments; treat as inactive.
    return false;
  }
}

async function queueJiraTaskSync(req, { taskId, action, projectId, sprintId }) {
  const orgPool = req.orgDb;
  if (!orgPool) return { queued: false, reason: 'no_org_db' };

  const active = await isJiraIntegrationActive(orgPool);
  if (!active) return { queued: false, reason: 'inactive' };

  try {
    const queues = getQueues();
    await queues.jiraSync.add(
      'jira-task-sync',
      {
        orgId: req.user?.orgId || null,
        taskId: String(taskId),
        action: String(action),
        projectId: projectId ? String(projectId) : null,
        sprintId: sprintId ? String(sprintId) : null,
      },
      { removeOnComplete: true, removeOnFail: 500 }
    );
    return { queued: true };
  } catch (e) {
    logger.warn({ err: e }, 'Failed to queue jira-sync job');
    return { queued: false, reason: 'queue_error' };
  }
}

module.exports = {
  isJiraIntegrationActive,
  queueJiraTaskSync,
};
