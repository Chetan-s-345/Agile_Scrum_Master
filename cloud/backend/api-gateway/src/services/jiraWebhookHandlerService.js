const { taskService } = require('./task.service');
const { sprintService } = require('./sprint.service');
const { logger } = require('../middleware/logger');

function safeString(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return s.trim();
}

function normalizeFieldName(item) {
  const field = safeString(item?.field).toLowerCase();
  const fieldId = safeString(item?.fieldId).toLowerCase();
  return field || fieldId;
}

function extractIssueKey(payload) {
  const key = payload?.issue?.key;
  return key ? String(key).trim() : null;
}

function extractSprintIdFromFields(fields) {
  const candidates = [fields?.sprint, fields?.customfield_10020, fields?.customfield_10021];
  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c) && c.length) {
      const first = c[0];
      if (first?.id != null) return String(first.id);
      if (typeof first === 'string') {
        const m = first.match(/\bid=(\d+)\b/);
        if (m) return m[1];
      }
    }
    if (c?.id != null) return String(c.id);
    if (typeof c === 'string') {
      const m = c.match(/\bid=(\d+)\b/);
      if (m) return m[1];
    }
  }
  return null;
}

async function handleIssueUpdated(orgPool, payload) {
  const issueKey = extractIssueKey(payload);
  if (!issueKey) return { ok: true, ignored: true, reason: 'missing_issue_key' };

  const items = Array.isArray(payload?.changelog?.items) ? payload.changelog.items : [];
  const results = [];

  for (const item of items) {
    const field = normalizeFieldName(item);

    try {
      if (field === 'assignee') {
        const newAccountId = safeString(item?.to) || safeString(item?.toString) || null;
        const r = await taskService.updateAssignee(issueKey, newAccountId, orgPool);
        results.push({ field: 'assignee', ok: true, result: r });
        continue;
      }

      if (field === 'status') {
        const newStatusName = safeString(item?.toString) || safeString(item?.to) || null;
        const r = await taskService.updateJiraStatus(issueKey, newStatusName, orgPool);
        results.push({ field: 'status', ok: true, result: r });
        continue;
      }

      if (field === 'story_points' || field === 'customfield_10016') {
        const raw = item?.toString ?? item?.to;
        const r = await taskService.updateStoryPoints(issueKey, raw, orgPool);
        results.push({ field: 'story_points', ok: true, result: r });
        continue;
      }

      results.push({ field: field || null, ok: true, ignored: true });
    } catch (err) {
      logger.error({ err, issueKey, field }, 'jira.webhook.issue_updated.item_failed');
      results.push({ field: field || null, ok: false, error: String(err?.message || err) });
    }
  }

  return { ok: true, issueKey, changes: results };
}

async function handleIssueCreated(orgPool, payload) {
  const issue = payload?.issue || null;
  const fields = issue?.fields || {};

  const jiraIssueId = issue?.id != null ? String(issue.id) : null;
  const jiraIssueKey = issue?.key != null ? String(issue.key) : null;
  if (!jiraIssueId || !jiraIssueKey) return { ok: true, ignored: true, reason: 'missing_issue_id_or_key' };

  const title = fields?.summary ? String(fields.summary) : jiraIssueKey;
  const description = fields?.description ? JSON.stringify(fields.description) : null;
  const type = fields?.issuetype?.name ? String(fields.issuetype.name).toLowerCase() : 'task';
  const priority = fields?.priority?.name ? String(fields.priority.name).toLowerCase() : 'medium';
  const labels = Array.isArray(fields?.labels) ? fields.labels : [];

  const storyPoints =
    fields?.story_points != null
      ? Number(fields.story_points)
      : fields?.customfield_10016 != null
        ? Number(fields.customfield_10016)
        : 0;

  const jiraSprintId = extractSprintIdFromFields(fields);

  if (jiraSprintId) {
    const sprintResp = await orgPool.query(
      'SELECT id, project_id FROM sprints WHERE jira_sprint_id = $1 LIMIT 1',
      [String(jiraSprintId)]
    );
    const sprint = sprintResp.rows[0] || null;

    if (sprint) {
      await orgPool.query(
        `INSERT INTO tasks (sprint_id, project_id, title, description, type, priority, story_points, tech_tags, jira_issue_id, jira_issue_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (jira_issue_id) DO UPDATE SET
           sprint_id = EXCLUDED.sprint_id,
           project_id = EXCLUDED.project_id,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           type = EXCLUDED.type,
           priority = EXCLUDED.priority,
           story_points = EXCLUDED.story_points,
           tech_tags = EXCLUDED.tech_tags,
           jira_issue_key = EXCLUDED.jira_issue_key,
           updated_at = NOW()`,
        [String(sprint.id), String(sprint.project_id), title, description, type, priority, Number.isFinite(storyPoints) ? storyPoints : 0, labels, jiraIssueId, jiraIssueKey]
      );
      return { ok: true, created: 'task', jiraIssueKey, jiraSprintId };
    }

    // Sprint exists in Jira but not locally yet: store as backlog item with status=in_sprint to avoid losing it.
    // This is still idempotent due to jira_issue_id UNIQUE.
    const projectKey = fields?.project?.key ? String(fields.project.key) : null;
    let projectId = null;
    if (projectKey) {
      const projResp = await orgPool.query('SELECT id FROM projects WHERE jira_project_key = $1 LIMIT 1', [projectKey]);
      projectId = projResp.rows[0]?.id || null;
    }

    if (!projectId) return { ok: true, ignored: true, reason: 'no_matching_project_for_backlog' };

    await orgPool.query(
      `INSERT INTO backlog_items (project_id, title, description, type, priority, status, story_points, tech_tags, jira_issue_id, jira_issue_key)
       VALUES ($1,$2,$3,$4,$5,'in_sprint',$6,$7,$8,$9)
       ON CONFLICT (jira_issue_id) DO UPDATE SET
         project_id = EXCLUDED.project_id,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         type = EXCLUDED.type,
         priority = EXCLUDED.priority,
         status = EXCLUDED.status,
         story_points = EXCLUDED.story_points,
         tech_tags = EXCLUDED.tech_tags,
         jira_issue_key = EXCLUDED.jira_issue_key,
         updated_at = NOW()`,
      [projectId, title, description, type, priority, Number.isFinite(storyPoints) ? storyPoints : 0, labels, jiraIssueId, jiraIssueKey]
    );

    return { ok: true, created: 'backlog_item', jiraIssueKey, jiraSprintId };
  }

  // No sprint field: store as backlog item.
  const projectKey = fields?.project?.key ? String(fields.project.key) : null;
  let projectId = null;
  if (projectKey) {
    const projResp = await orgPool.query('SELECT id FROM projects WHERE jira_project_key = $1 LIMIT 1', [projectKey]);
    projectId = projResp.rows[0]?.id || null;
  }

  if (!projectId) return { ok: true, ignored: true, reason: 'no_matching_project' };

  await orgPool.query(
    `INSERT INTO backlog_items (project_id, title, description, type, priority, status, story_points, tech_tags, jira_issue_id, jira_issue_key)
     VALUES ($1,$2,$3,$4,$5,'backlog',$6,$7,$8,$9)
     ON CONFLICT (jira_issue_id) DO UPDATE SET
       project_id = EXCLUDED.project_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       type = EXCLUDED.type,
       priority = EXCLUDED.priority,
       story_points = EXCLUDED.story_points,
       tech_tags = EXCLUDED.tech_tags,
       jira_issue_key = EXCLUDED.jira_issue_key,
       updated_at = NOW()`,
    [projectId, title, description, type, priority, Number.isFinite(storyPoints) ? storyPoints : 0, labels, jiraIssueId, jiraIssueKey]
  );

  return { ok: true, created: 'backlog_item', jiraIssueKey };
}

async function handleSprintCompleted(orgPool, payload) {
  const sprint = payload?.sprint || payload?.sprintEvent || payload?.sprintEventData || null;
  const jiraSprintId = sprint?.id != null ? String(sprint.id) : payload?.sprintId != null ? String(payload.sprintId) : null;
  if (!jiraSprintId) return { ok: true, ignored: true, reason: 'missing_sprint_id' };

  const local = await orgPool.query('SELECT id FROM sprints WHERE jira_sprint_id = $1 LIMIT 1', [String(jiraSprintId)]);
  const sprintRow = local.rows[0] || null;
  if (!sprintRow) return { ok: true, ignored: true, reason: 'no_local_sprint' };

  const r = await sprintService.completeSprintFlow(String(sprintRow.id), orgPool);
  return { ok: true, completed: true, jiraSprintId, sprintId: String(sprintRow.id), result: r };
}

async function handleJiraWebhookEvent(orgPool, eventType, payload) {
  const t = safeString(eventType);

  if (t === 'jira:issue_updated') return handleIssueUpdated(orgPool, payload);
  if (t === 'jira:issue_created') return handleIssueCreated(orgPool, payload);

  // Some Jira setups use jira:sprint_closed for sprint completion.
  if (t === 'sprint_completed' || t === 'jira:sprint_closed' || t === 'jira:sprint_completed') {
    return handleSprintCompleted(orgPool, payload);
  }

  return { ok: true, ignored: true, eventType: t || null };
}

module.exports = {
  handleJiraWebhookEvent,
  handleIssueUpdated,
  handleIssueCreated,
  handleSprintCompleted,
};
