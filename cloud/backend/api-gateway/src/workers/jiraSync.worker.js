const { Worker } = require('bullmq');

const { getRedis } = require('../services/queue.service');
const { db } = require('../config/database');
const { jiraService } = require('../services/jiraService');
const { logger } = require('../middleware/logger');

let _worker = null;

function syncStatusKey(orgId) {
  return `jira-sync:status:${String(orgId)}`;
}

async function writeSyncStatus(redis, orgId, status) {
  try {
    await redis.set(syncStatusKey(orgId), JSON.stringify(status), 'EX', 60 * 60);
  } catch (e) {
    logger.debug({ err: e }, 'Failed to write Jira sync status to Redis');
  }
}

async function updateProjectSyncState(orgPool, { projectKey, boardId, mode, status, errorMessage }) {
  try {
    await orgPool.query(
      `INSERT INTO jira_project_sync_state (project_key, board_id, last_synced_at, last_mode, last_status, last_error, updated_at)
       VALUES ($1,$2,NOW(),$3,$4,$5,NOW())
       ON CONFLICT (project_key, board_id) DO UPDATE SET
         last_synced_at = EXCLUDED.last_synced_at,
         last_mode = EXCLUDED.last_mode,
         last_status = EXCLUDED.last_status,
         last_error = EXCLUDED.last_error,
         updated_at = NOW()`,
      [String(projectKey), String(boardId || ''), mode ? String(mode) : null, String(status), errorMessage || null]
    );
  } catch (e) {
    logger.debug({ err: e }, 'Unable to update jira_project_sync_state');
  }
}

async function getProjectLastSyncedAt(orgPool, { projectKey, boardId }) {
  try {
    const resp = await orgPool.query(
      `SELECT last_synced_at
       FROM jira_project_sync_state
       WHERE project_key = $1 AND board_id = $2
       LIMIT 1`,
      [String(projectKey), String(boardId || '')]
    );
    return resp.rows[0]?.last_synced_at || null;
  } catch {
    return null;
  }
}

async function isJiraIntegrationActive(orgPool) {
  try {
    const resp = await orgPool.query('SELECT 1 FROM jira_integration WHERE is_active = TRUE LIMIT 1');
    return resp.rows.length > 0;
  } catch {
    return false;
  }
}

async function getJiraFieldMappings(orgPool) {
  try {
    const resp = await orgPool.query('SELECT field_mappings FROM jira_integration WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
    return resp.rows[0]?.field_mappings || {};
  } catch {
    return {};
  }
}

function defaultStatusNameForJira(internalStatus, fieldMappings) {
  const key = String(internalStatus || '').trim();
  const map = fieldMappings?.statusMap && typeof fieldMappings.statusMap === 'object' ? fieldMappings.statusMap : null;
  const explicit = map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
  if (explicit) return String(explicit);

  const v = key.toLowerCase();
  if (v === 'todo') return 'To Do';
  if (v === 'in_progress') return 'In Progress';
  if (v === 'in_review') return 'In Review';
  if (v === 'blocked') return 'Blocked';
  if (v === 'done') return 'Done';
  if (v === 'cancelled') return 'Done';
  return 'To Do';
}

function defaultIssueTypeForJira(internalType) {
  const v = String(internalType || '').trim().toLowerCase();
  if (!v) return 'Task';
  if (v === 'task') return 'Task';
  if (v === 'story') return 'Story';
  if (v === 'bug') return 'Bug';
  if (v === 'epic') return 'Epic';
  return 'Task';
}

function defaultPriorityForJira(internalPriority) {
  const v = String(internalPriority || '').trim().toLowerCase();
  if (!v) return 'Medium';
  if (v === 'low') return 'Low';
  if (v === 'medium') return 'Medium';
  if (v === 'high') return 'High';
  if (v === 'critical') return 'Highest';
  return 'Medium';
}

async function setTaskJiraSynced(orgPool, taskId, synced) {
  try {
    await orgPool.query(
      `UPDATE tasks
       SET jira_synced = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [String(taskId), Boolean(synced)]
    );
  } catch (e) {
    // Column may not exist yet in some environments; ignore.
    logger.debug({ err: e }, 'Unable to update tasks.jira_synced');
  }
}

async function getTaskSyncContext(orgPool, taskId) {
  const resp = await orgPool.query(
    `SELECT
       t.id,
       t.project_id,
       t.sprint_id,
       t.title,
       t.description,
       t.type,
       t.priority,
       t.status,
       t.story_points,
       t.jira_issue_id,
       t.jira_issue_key,
       s.jira_sprint_id,
       tm.jira_account_id
     FROM tasks t
     LEFT JOIN sprints s ON s.id = t.sprint_id
     LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
     LEFT JOIN team_members tm ON tm.id = dp.member_id
     WHERE t.id = $1
     LIMIT 1`,
    [String(taskId)]
  );

  return resp.rows[0] || null;
}

async function insertJiraSyncLog(orgPool, row) {
  try {
    await orgPool.query(
      `INSERT INTO jira_sync_log (
         sync_type,
         direction,
         action,
         task_id,
         jira_issue_key,
         request_payload,
         response_payload,
         status,
         error_message,
         started_at,
         completed_at,
         duration_ms,
         records_synced,
         records_failed
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
       )`,
      [
        String(row.syncType || 'outbound_task'),
        String(row.direction || 'outbound'),
        row.action ? String(row.action) : null,
        row.taskId ? String(row.taskId) : null,
        row.jiraIssueKey ? String(row.jiraIssueKey) : null,
        row.requestPayload ?? null,
        row.responsePayload ?? null,
        String(row.status || 'success'),
        row.errorMessage ? String(row.errorMessage) : null,
        row.startedAt || new Date(),
        row.completedAt || new Date(),
        Number.isFinite(row.durationMs) ? Number(row.durationMs) : null,
        Number.isFinite(row.recordsSynced) ? Number(row.recordsSynced) : 0,
        Number.isFinite(row.recordsFailed) ? Number(row.recordsFailed) : 0,
      ]
    );
  } catch (e) {
    // Best-effort only; keep worker behavior unchanged if table/columns don't exist.
    logger.debug({ err: e }, 'Unable to write jira_sync_log detail row');
  }
}

function summarizeHttpError(err) {
  try {
    const status = err?.response?.status;
    const data = err?.response?.data;
    if (status || data) {
      return {
        message: String(err?.message || 'Request failed'),
        status: status ?? null,
        data: data ?? null,
      };
    }
  } catch {
    // ignore
  }
  return null;
}

async function ensureJiraIssueExists(orgPool, task) {
  const key = String(task?.jira_issue_key || '').trim();
  const id = String(task?.jira_issue_id || '').trim();
  if (key || id) return { jiraIssueKey: key || null, jiraIssueId: id || null };

  const startedAt = new Date();
  const created = await jiraService.createIssue(
    {
      taskId: String(task.id),
      summary: String(task.title),
      description: task.description || null,
      issuetype: defaultIssueTypeForJira(task.type),
      priority: defaultPriorityForJira(task.priority),
      storyPoints: Number(task.story_points || 0),
    },
    orgPool
  );

  await insertJiraSyncLog(orgPool, {
    syncType: 'outbound_task',
    direction: 'outbound',
    action: 'createIssue',
    taskId: String(task.id),
    jiraIssueKey: created.jiraIssueKey || null,
    requestPayload: {
      taskId: String(task.id),
      summary: String(task.title),
      description: task.description || null,
      issuetype: defaultIssueTypeForJira(task.type),
      priority: defaultPriorityForJira(task.priority),
      storyPoints: Number(task.story_points || 0),
    },
    responsePayload: created,
    status: 'success',
    startedAt,
    completedAt: new Date(),
    durationMs: Date.now() - startedAt.getTime(),
    recordsSynced: 1,
    recordsFailed: 0,
  });

  return { jiraIssueKey: created.jiraIssueKey || null, jiraIssueId: created.jiraIssueId || null };
}

async function processTaskSync(orgPool, { taskId, action }) {
  const task = await getTaskSyncContext(orgPool, taskId);
  if (!task) return { ok: true, ignored: true, reason: 'task_not_found' };

  const fieldMappings = await getJiraFieldMappings(orgPool);

  await setTaskJiraSynced(orgPool, taskId, false);

  const { jiraIssueKey, jiraIssueId } = await ensureJiraIssueExists(orgPool, task);
  const issueIdOrKey = jiraIssueKey || jiraIssueId;
  if (!issueIdOrKey) throw new Error('Failed to determine Jira issue key/id');

  const normalizedAction = String(action || '').toLowerCase();

  // For create/update/retry we sync the full snapshot; for others, we do targeted updates.
  const doSnapshot = normalizedAction === 'create' || normalizedAction === 'update' || normalizedAction === 'sync_snapshot';

  if (doSnapshot || normalizedAction === 'assignee_update') {
    const accountId = String(task.jira_account_id || '').trim();
    if (accountId) {
      const startedAt = new Date();
      try {
        await jiraService.updateAssignee(issueIdOrKey, accountId, orgPool);
        await insertJiraSyncLog(orgPool, {
          action: 'updateAssignee',
          taskId: String(task.id),
          jiraIssueKey: jiraIssueKey || null,
          requestPayload: { issueIdOrKey, accountId },
          responsePayload: { ok: true },
          status: 'success',
          startedAt,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          recordsSynced: 1,
          recordsFailed: 0,
        });
      } catch (e) {
        const http = summarizeHttpError(e);
        await insertJiraSyncLog(orgPool, {
          action: 'updateAssignee',
          taskId: String(task.id),
          jiraIssueKey: jiraIssueKey || null,
          requestPayload: { issueIdOrKey, accountId },
          responsePayload: http,
          status: 'failed',
          errorMessage: String(e?.message || e),
          startedAt,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          recordsSynced: 0,
          recordsFailed: 1,
        });
        throw e;
      }
    }
  }

  if (doSnapshot || normalizedAction === 'status_update') {
    const internalStatus = String(task.status || '').trim().toLowerCase();
    if (internalStatus && internalStatus !== 'todo') {
      const jiraStatusName = defaultStatusNameForJira(task.status, fieldMappings);
      if (jiraStatusName) {
        const startedAt = new Date();
        try {
          await jiraService.updateStatusByName(issueIdOrKey, jiraStatusName, orgPool);
          await insertJiraSyncLog(orgPool, {
            action: 'updateStatus',
            taskId: String(task.id),
            jiraIssueKey: jiraIssueKey || null,
            requestPayload: { issueIdOrKey, jiraStatusName },
            responsePayload: { ok: true },
            status: 'success',
            startedAt,
            completedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            recordsSynced: 1,
            recordsFailed: 0,
          });
        } catch (e) {
          const http = summarizeHttpError(e);
          await insertJiraSyncLog(orgPool, {
            action: 'updateStatus',
            taskId: String(task.id),
            jiraIssueKey: jiraIssueKey || null,
            requestPayload: { issueIdOrKey, jiraStatusName },
            responsePayload: http,
            status: 'failed',
            errorMessage: String(e?.message || e),
            startedAt,
            completedAt: new Date(),
            durationMs: Date.now() - startedAt.getTime(),
            recordsSynced: 0,
            recordsFailed: 1,
          });
          throw e;
        }
      }
    }
  }

  if (doSnapshot || normalizedAction === 'move_to_sprint') {
    const jiraSprintId = String(task.jira_sprint_id || '').trim();
    if (jiraSprintId) {
      const startedAt = new Date();
      try {
        await jiraService.moveToSprint(issueIdOrKey, jiraSprintId, orgPool);
        await insertJiraSyncLog(orgPool, {
          action: 'moveToSprint',
          taskId: String(task.id),
          jiraIssueKey: jiraIssueKey || null,
          requestPayload: { issueIdOrKey, jiraSprintId },
          responsePayload: { ok: true },
          status: 'success',
          startedAt,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          recordsSynced: 1,
          recordsFailed: 0,
        });
      } catch (e) {
        const http = summarizeHttpError(e);
        await insertJiraSyncLog(orgPool, {
          action: 'moveToSprint',
          taskId: String(task.id),
          jiraIssueKey: jiraIssueKey || null,
          requestPayload: { issueIdOrKey, jiraSprintId },
          responsePayload: http,
          status: 'failed',
          errorMessage: String(e?.message || e),
          startedAt,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
          recordsSynced: 0,
          recordsFailed: 1,
        });
        throw e;
      }
    }
  }

  await setTaskJiraSynced(orgPool, taskId, true);
  return { ok: true };
}

async function listOrgIdsWithTenantDb() {
  try {
    const hasConnCol = await db._orgHasColumn('db_connection_string');
    if (!hasConnCol) return [];

    const resp = await db.universalPool.query(
      `SELECT id
       FROM organizations
       WHERE db_connection_string IS NOT NULL
         AND LENGTH(TRIM(db_connection_string)) > 0`
    );

    return resp.rows.map((r) => String(r.id));
  } catch (e) {
    logger.warn({ err: e }, 'Failed to list organizations for Jira retry');
    return [];
  }
}

function startJiraSyncWorker() {
  if (_worker) return _worker;

  const connection = getRedis();

  _worker = new Worker(
    'jira-sync',
    async (job) => {
      if (job.name === 'full-sync') {
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
      }

      if (job.name === 'jira-task-sync') {
        const orgId = job.data?.orgId;
        const taskId = job.data?.taskId;
        const action = job.data?.action;
        if (!orgId || !taskId) throw new Error('Missing orgId/taskId for jira-task-sync');

        const orgPool = await db.getOrgPool(String(orgId));
        const active = await isJiraIntegrationActive(orgPool);
        if (!active) return { ok: true, ignored: true, reason: 'inactive' };

        try {
          return await processTaskSync(orgPool, { taskId, action });
        } catch (e) {
          await setTaskJiraSynced(orgPool, taskId, false);
          throw e;
        }
      }

      if (job.name === 'project-sync') {
        const orgId = job.data?.orgId;
        const projectKey = job.data?.projectKey;
        const boardId = job.data?.boardId;
        const mode = job.data?.mode || 'incremental';
        if (!orgId || !projectKey) throw new Error('Missing orgId/projectKey for project-sync');

        const orgPool = await db.getOrgPool(String(orgId));
        const active = await isJiraIntegrationActive(orgPool);
        if (!active) return { ok: true, ignored: true, reason: 'inactive' };

        const redis = getRedis();

        const normalizedMode = String(mode);
        const normalizedBoardId = boardId ? String(boardId) : '';

        const lastSyncedAt = await getProjectLastSyncedAt(orgPool, {
          projectKey: String(projectKey),
          boardId: normalizedBoardId,
        });

        const since = normalizedMode === 'incremental' ? lastSyncedAt : null;

        let backlogTotal = 0;
        let sprintTotal = 0;
        try {
          if (normalizedMode !== 'active_sprint') {
            backlogTotal = await jiraService.countBacklogIssues(orgPool, {
              projectKey: String(projectKey),
              mode: normalizedMode,
              since,
            });
          }

          if (normalizedBoardId) {
            const sprintInfo = await jiraService.countActiveSprintIssues(orgPool, { boardId: normalizedBoardId });
            sprintTotal = Number(sprintInfo.total || 0) || 0;
          }
        } catch {
          backlogTotal = backlogTotal || 0;
          sprintTotal = sprintTotal || 0;
        }

        const total = backlogTotal + sprintTotal;
        let backlogProcessed = 0;
        let sprintProcessed = 0;

        const startedAtIso = new Date().toISOString();
        await writeSyncStatus(redis, orgId, {
          syncing: true,
          projectKey: String(projectKey),
          boardId: normalizedBoardId || null,
          mode: normalizedMode,
          processed: 0,
          total,
          message: 'Syncing…',
          startedAt: startedAtIso,
        });

        try {
          if (normalizedMode !== 'active_sprint') {
            await jiraService.syncBacklogFor(orgPool, {
              projectKey: String(projectKey),
              mode: normalizedMode,
              since,
              onProgress: ({ processed, total: phaseTotal }) => {
                backlogProcessed = Number(processed || 0) || 0;
                void writeSyncStatus(redis, orgId, {
                  syncing: true,
                  projectKey: String(projectKey),
                  boardId: normalizedBoardId || null,
                  mode: normalizedMode,
                  processed: backlogProcessed + sprintProcessed,
                  total: Number.isFinite(total) ? total : (Number(phaseTotal || 0) || 0) + sprintTotal,
                  message: 'Syncing…',
                  startedAt: startedAtIso,
                });
              },
            });
          }

          if (normalizedBoardId && (normalizedMode === 'active_sprint' || normalizedMode === 'incremental' || normalizedMode === 'full_30d')) {
            await jiraService.syncActiveSprintFor(orgPool, {
              projectKey: String(projectKey),
              boardId: normalizedBoardId,
              onProgress: ({ processed, total: phaseTotal }) => {
                sprintProcessed = Number(processed || 0) || 0;
                void writeSyncStatus(redis, orgId, {
                  syncing: true,
                  projectKey: String(projectKey),
                  boardId: normalizedBoardId || null,
                  mode: normalizedMode,
                  processed: backlogProcessed + sprintProcessed,
                  total: Number.isFinite(total) ? total : backlogTotal + (Number(phaseTotal || 0) || 0),
                  message: 'Syncing…',
                  startedAt: startedAtIso,
                });
              },
            });
          }

          await updateProjectSyncState(orgPool, {
            projectKey: String(projectKey),
            boardId: normalizedBoardId,
            mode: normalizedMode,
            status: 'success',
            errorMessage: null,
          });

          await writeSyncStatus(redis, orgId, {
            syncing: false,
            projectKey: String(projectKey),
            boardId: normalizedBoardId || null,
            mode: normalizedMode,
            processed: backlogProcessed + sprintProcessed,
            total,
            message: 'Complete',
            startedAt: startedAtIso,
            completedAt: new Date().toISOString(),
          });

          return { ok: true, processed: backlogProcessed + sprintProcessed, total };
        } catch (e) {
          const msg = String(e?.message || e);
          await updateProjectSyncState(orgPool, {
            projectKey: String(projectKey),
            boardId: normalizedBoardId,
            mode: normalizedMode,
            status: 'failed',
            errorMessage: msg,
          });

          await writeSyncStatus(redis, orgId, {
            syncing: false,
            projectKey: String(projectKey),
            boardId: normalizedBoardId || null,
            mode: normalizedMode,
            processed: backlogProcessed + sprintProcessed,
            total,
            message: msg,
            startedAt: startedAtIso,
            completedAt: new Date().toISOString(),
          });
          throw e;
        }
      }

      if (job.name === 'retry-unsynced-tasks') {
        const explicitOrgId = job.data?.orgId ? String(job.data.orgId) : null;
        const orgIds = explicitOrgId ? [explicitOrgId] : await listOrgIdsWithTenantDb();
        const limitPerOrg = Number(job.data?.limitPerOrg || 25);

        const results = [];
        for (const orgId of orgIds) {
          let orgPool = null;
          try {
            orgPool = await db.getOrgPool(String(orgId));
          } catch {
            results.push({ orgId, ok: false, reason: 'org_pool_unavailable' });
            continue;
          }

          const active = await isJiraIntegrationActive(orgPool);
          if (!active) {
            results.push({ orgId, ok: true, skipped: true, reason: 'inactive' });
            continue;
          }

          let taskIds = [];
          try {
            const resp = await orgPool.query(
              `SELECT id
               FROM tasks
               WHERE jira_synced = FALSE
               ORDER BY updated_at DESC
               LIMIT $1`,
              [limitPerOrg]
            );
            taskIds = resp.rows.map((r) => String(r.id));
          } catch (e) {
            results.push({ orgId, ok: false, reason: 'query_failed', error: String(e?.message || e) });
            continue;
          }

          for (const taskId of taskIds) {
            try {
              await processTaskSync(orgPool, { taskId, action: 'sync_snapshot' });
            } catch (e) {
              // Keep going; individual task errors should not stop the batch.
              logger.warn({ err: e, orgId, taskId }, 'Retry sync failed for task');
            }
          }

          results.push({ orgId, ok: true, retried: taskIds.length });
        }

        return { ok: true, results };
      }

      logger.warn({ jobName: job.name }, 'Unknown jira-sync job');
      return { ok: true, ignored: true, jobName: job.name };
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
