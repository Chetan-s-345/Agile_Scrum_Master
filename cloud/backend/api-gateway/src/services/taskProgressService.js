const { env } = require('../config/env');
const { jiraService } = require('./jiraService');
const { logger } = require('../middleware/logger');

function text(value) {
  return String(value || '').trim();
}

function parseUnique(regex, input) {
  const out = new Set();
  const s = text(input);
  if (!s) return out;
  const matches = s.matchAll(regex);
  for (const m of matches) {
    if (m?.[1]) out.add(String(m[1]));
  }
  return out;
}

function parsePrefixes() {
  const raw = text(env.GITHUB_TASK_PREFIX);
  if (!raw) return [];
  return raw
    .split(',')
    .map((p) => text(p).toUpperCase())
    .filter(Boolean);
}

function collectTextCandidates(payload, fallbackText) {
  const parts = [];
  if (fallbackText) parts.push(String(fallbackText));

  if (payload?.ref) parts.push(String(payload.ref));
  if (payload?.pull_request?.head?.ref) parts.push(String(payload.pull_request.head.ref));
  if (payload?.pull_request?.title) parts.push(String(payload.pull_request.title));
  if (payload?.pull_request?.body) parts.push(String(payload.pull_request.body));
  if (payload?.issue?.title) parts.push(String(payload.issue.title));
  if (payload?.issue?.body) parts.push(String(payload.issue.body));

  const commits = Array.isArray(payload?.commits) ? payload.commits : [];
  for (const c of commits) {
    if (c?.message) parts.push(String(c.message));
  }

  return parts.join('\n');
}

function hasCompletionEvidence(textValue) {
  const value = text(textValue).toLowerCase();
  if (!value) return false;

  const completionKeyword = /\b(fix(?:es|ed)?|close(?:s|d)?|resolve(?:s|d)?|complete(?:s|d)?|done|finished)\b/i.test(value);
  const taskReference = /\b([A-Z][A-Z0-9]+-\d+|task-\d+)\b/i.test(value);
  const mergedKeyword = /\bmerged\b/i.test(value);

  return (completionKeyword && taskReference) || (mergedKeyword && taskReference);
}

async function queryTaskByJiraKey(orgPool, jiraKeys, repoName) {
  if (!jiraKeys.length) return null;
  const resp = await orgPool.query(
    `SELECT t.id, t.jira_issue_key, t.sprint_id, t.project_id
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.jira_issue_key = ANY($1::text[])
       AND ($2::text IS NULL OR p.github_repo IS NULL OR LOWER(p.github_repo) = LOWER($2))
     ORDER BY t.updated_at DESC
     LIMIT 1`,
    [jiraKeys, repoName || null]
  );
  return resp.rows[0] || null;
}

async function queryTaskByUuidToken(orgPool, taskTokens) {
  for (const token of taskTokens) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
      const byId = await orgPool.query('SELECT id, jira_issue_key, sprint_id, project_id FROM tasks WHERE id = $1 LIMIT 1', [String(token)]);
      if (byId.rows[0]) return byId.rows[0];
      continue;
    }

    const byAlias = await orgPool.query(
      `SELECT id, jira_issue_key, sprint_id, project_id
       FROM tasks
       WHERE title ILIKE $1
          OR COALESCE(description, '') ILIKE $1
          OR COALESCE(acceptance_criteria, '') ILIKE $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [`%task-${String(token)}%`]
    );
    if (byAlias.rows[0]) return byAlias.rows[0];
  }
  return null;
}

async function queryTaskByCustomToken(orgPool, customTokens, repoName) {
  if (!customTokens.length) return null;
  const resp = await orgPool.query(
    `SELECT t.id, t.jira_issue_key, t.sprint_id, t.project_id
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE (
       t.title ILIKE ANY($1::text[])
       OR COALESCE(t.description, '') ILIKE ANY($1::text[])
       OR COALESCE(t.acceptance_criteria, '') ILIKE ANY($1::text[])
     )
     AND ($2::text IS NULL OR p.github_repo IS NULL OR LOWER(p.github_repo) = LOWER($2))
     ORDER BY t.updated_at DESC
     LIMIT 1`,
    [customTokens.map((t) => `%${t}%`), repoName || null]
  );
  return resp.rows[0] || null;
}

async function queryTaskByIssueNumber(orgPool, issueNumbers, repoName) {
  if (!issueNumbers.length) return null;

  const mentionPatterns = issueNumbers.map((n) => `%#${n}%`);
  const byMention = await orgPool.query(
    `SELECT t.id, t.jira_issue_key, t.sprint_id, t.project_id
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE (
       t.title ILIKE ANY($1::text[])
       OR COALESCE(t.description, '') ILIKE ANY($1::text[])
       OR COALESCE(t.acceptance_criteria, '') ILIKE ANY($1::text[])
     )
     AND ($2::text IS NULL OR p.github_repo IS NULL OR LOWER(p.github_repo) = LOWER($2))
     ORDER BY t.updated_at DESC
     LIMIT 1`,
    [mentionPatterns, repoName || null]
  );
  if (byMention.rows[0]) return byMention.rows[0];

  const byPrNumber = await orgPool.query(
    `SELECT t.id, t.jira_issue_key, t.sprint_id, t.project_id
     FROM github_events ge
     JOIN tasks t ON t.id = ge.task_id
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE ge.github_pr_number = ANY($1::int[])
       AND ge.task_id IS NOT NULL
       AND ($2::text IS NULL OR p.github_repo IS NULL OR LOWER(p.github_repo) = LOWER($2))
     ORDER BY ge.event_at DESC
     LIMIT 1`,
    [issueNumbers.map((n) => Number(n)), repoName || null]
  );

  return byPrNumber.rows[0] || null;
}

async function resolveLinkedTask(orgPool, payload, fallbackText, repoName) {
  const combinedText = collectTextCandidates(payload, fallbackText);

  const jiraKeys = Array.from(parseUnique(/\b([A-Z][A-Z0-9]+-\d+)\b/g, combinedText));
  const taskTokens = Array.from(parseUnique(/\btask-([A-Za-z0-9-]{3,64})\b/gi, combinedText));
  const issueNumbers = Array.from(parseUnique(/(?:^|\s)#(\d+)\b/g, combinedText));

  if (payload?.issue?.number) issueNumbers.push(String(payload.issue.number));
  if (payload?.pull_request?.number) issueNumbers.push(String(payload.pull_request.number));
  if (payload?.number) issueNumbers.push(String(payload.number));

  const customPrefixes = parsePrefixes();
  const customTokens = [];
  for (const prefix of customPrefixes) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = parseUnique(new RegExp(`\\b(${escaped}\\d+)\\b`, 'gi'), combinedText);
    for (const item of matches) customTokens.push(String(item).toUpperCase());
  }

  const uniqueIssueNumbers = Array.from(new Set(issueNumbers.filter((v) => /^\d+$/.test(v))));

  const byJira = await queryTaskByJiraKey(orgPool, jiraKeys, repoName);
  if (byJira) return { taskId: byJira.id, jiraIssueKey: byJira.jira_issue_key || null, sprintId: byJira.sprint_id || null, projectId: byJira.project_id || null };

  const byUuid = await queryTaskByUuidToken(orgPool, taskTokens);
  if (byUuid) return { taskId: byUuid.id, jiraIssueKey: byUuid.jira_issue_key || null, sprintId: byUuid.sprint_id || null, projectId: byUuid.project_id || null };

  const byCustom = await queryTaskByCustomToken(orgPool, customTokens, repoName);
  if (byCustom) return { taskId: byCustom.id, jiraIssueKey: byCustom.jira_issue_key || null, sprintId: byCustom.sprint_id || null, projectId: byCustom.project_id || null };

  const byIssueNum = await queryTaskByIssueNumber(orgPool, uniqueIssueNumbers, repoName);
  if (byIssueNum) return { taskId: byIssueNum.id, jiraIssueKey: byIssueNum.jira_issue_key || null, sprintId: byIssueNum.sprint_id || null, projectId: byIssueNum.project_id || null };

  return { taskId: null, jiraIssueKey: jiraKeys[0] || null, sprintId: null, projectId: null };
}

async function updateProgress(orgPool, taskId, progress, options) {
  const setDone = Boolean(options?.setDone);
  const branch = text(options?.branch) || null;
  const prUrl = text(options?.prUrl) || null;
  const githubEvent = text(options?.eventType) || null;

  const updateResp = await orgPool.query(
    `UPDATE tasks
     SET progress = GREATEST(COALESCE(progress, 0), $2),
         status = CASE WHEN $3 THEN 'done' ELSE status END,
         completed_at = CASE WHEN $3 AND completed_at IS NULL THEN NOW() ELSE completed_at END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, progress, status`,
    [String(taskId), Number(progress), setDone]
  );

  if (!updateResp.rows[0]) return null;

  await orgPool.query(
    `INSERT INTO task_comments (task_id, author_id, content, comment_type, metadata)
     VALUES ($1, NULL, $2, 'status_change', $3::jsonb)`,
    [
      String(taskId),
      `GitHub progress updated to ${Number(progress)}%`,
      JSON.stringify({ source: 'github', progress: Number(progress), githubEvent, branch, prUrl }),
    ]
  );

  return updateResp.rows[0];
}

async function completeTaskById(orgPool, taskId, payload, eventType) {
  const currentResp = await orgPool.query(
    `SELECT id, status, jira_issue_key, sprint_id, project_id, title
     FROM tasks
     WHERE id = $1
     LIMIT 1`,
    [String(taskId)]
  );
  const task = currentResp.rows[0] || null;
  if (!task) return { ok: false, ignored: true, reason: 'task_not_found' };
  if (String(task.status) === 'done') return { ok: true, ignored: true, reason: 'already_done', taskId: String(task.id) };

  await orgPool.query(
    `UPDATE tasks
     SET status = 'done',
         progress = GREATEST(COALESCE(progress, 0), 100),
         completed_at = COALESCE(completed_at, NOW()),
         updated_at = NOW()
     WHERE id = $1`,
    [String(taskId)]
  );

  await orgPool.query(
    `INSERT INTO task_comments (task_id, author_id, content, comment_type, metadata)
     VALUES ($1, NULL, $2, 'status_change', $3::jsonb)`,
    [
      String(taskId),
      `Automatically marked done from GitHub ${eventType || 'evidence'}.`,
      JSON.stringify({
        source: 'github',
        eventType: eventType || null,
        branch: text(payload?.ref || payload?.pull_request?.head?.ref) || null,
        prUrl: text(payload?.pull_request?.html_url) || text(payload?.html_url) || null,
        commitSha: text(payload?.after) || text(payload?.head_commit?.id) || null,
      }),
    ]
  );

  return { ok: true, taskId: String(task.id), completed: true };
}

async function applyRule(orgPool, payload, rule) {
  const repoName = text(payload?.repository?.full_name) || text(payload?.repository?.name) || null;
  const branch = text(payload?.ref).replace(/^refs\/heads\//, '') || text(payload?.pull_request?.head?.ref) || null;
  const prUrl = text(payload?.pull_request?.html_url) || text(payload?.html_url) || null;
  const fallbackText = `${branch || ''}\n${text(payload?.pull_request?.title)}\n${text(payload?.pull_request?.body)}`;

  const linked = await resolveLinkedTask(orgPool, payload, fallbackText, repoName);
  if (!linked.taskId) return { linked: false };

  const updated = await updateProgress(orgPool, linked.taskId, rule.progress, {
    setDone: Boolean(rule.setDone),
    eventType: rule.eventType,
    branch,
    prUrl,
  });

  if (rule.setDone && linked.jiraIssueKey) {
    try {
      await jiraService.updateStatusByName(linked.jiraIssueKey, 'Done', orgPool);
    } catch (err) {
      logger.warn({ err, taskId: linked.taskId, jiraIssueKey: linked.jiraIssueKey }, 'github.progress.jira_status_sync_failed');
    }
  }

  return { linked: true, taskId: linked.taskId, sprintId: linked.sprintId || null, projectId: linked.projectId || null, updated };
}

async function getProgress(orgPool, taskId) {
  const taskResp = await orgPool.query('SELECT id, progress FROM tasks WHERE id = $1 LIMIT 1', [String(taskId)]);
  const task = taskResp.rows[0] || null;
  if (!task) return null;

  const eventResp = await orgPool.query(
    `SELECT event_type, branch_name, raw_payload, event_at
     FROM github_events
     WHERE task_id = $1
     ORDER BY event_at DESC
     LIMIT 1`,
    [String(taskId)]
  );

  const event = eventResp.rows[0] || null;
  const raw = event?.raw_payload || {};
  const prUrl = text(raw?.pull_request?.html_url) || text(raw?.html_url) || null;
  const branch = text(event?.branch_name) || text(raw?.pull_request?.head?.ref) || null;

  return {
    progress: Number(task.progress || 0),
    lastGithubEvent: event?.event_type || null,
    prUrl,
    branch,
  };
}

class TaskProgressService {
  async onBranchCreated(orgPool, payload) {
    return applyRule(orgPool, payload, { progress: 10, eventType: 'branch_created' });
  }

  async onFirstCommitPushed(orgPool, payload) {
    return applyRule(orgPool, payload, { progress: 25, eventType: 'first_commit_pushed' });
  }

  async onPrOpened(orgPool, payload) {
    return applyRule(orgPool, payload, { progress: 50, eventType: 'pr_opened' });
  }

  async onPrReviewRequested(orgPool, payload) {
    return applyRule(orgPool, payload, { progress: 65, eventType: 'pr_review_requested' });
  }

  async onPrApproved(orgPool, payload) {
    return applyRule(orgPool, payload, { progress: 80, eventType: 'pr_approved' });
  }

  async onPrMerged(orgPool, payload) {
    const result = await applyRule(orgPool, payload, { progress: 100, setDone: true, eventType: 'pr_merged' });
    if (!result?.taskId) return result;
    return result;
  }

  async onRelevantCommitPushed(orgPool, payload, details) {
    const repoName = text(payload?.repository?.full_name) || text(payload?.repository?.name) || null;
    const linked = await resolveLinkedTask(orgPool, payload, text(details?.commitMessage || ''), repoName);
    if (!linked.taskId) return { linked: false };

    if (!hasCompletionEvidence(`${details?.commitMessage || ''} ${payload?.head_commit?.message || ''} ${payload?.ref || ''}`)) {
      return { linked: true, taskId: linked.taskId, completed: false, reason: 'insufficient_completion_evidence' };
    }

    const completed = await completeTaskById(orgPool, linked.taskId, payload, 'commit_completed');
    if (!completed.ok) return completed;
    return { linked: true, taskId: linked.taskId, completed: true };
  }

  async getTaskProgress(orgPool, taskId) {
    return getProgress(orgPool, taskId);
  }

  async resolveTask(orgPool, payload, fallbackText, repoName) {
    return resolveLinkedTask(orgPool, payload, fallbackText, repoName);
  }
}

const taskProgressService = new TaskProgressService();

module.exports = {
  TaskProgressService,
  taskProgressService,
};
