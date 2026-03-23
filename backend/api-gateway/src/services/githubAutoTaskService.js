function safeText(value) {
  return String(value || '').trim();
}

function normalizeTaskType(rawType) {
  const t = safeText(rawType).toLowerCase();
  if (t === 'bug') return 'bug';
  if (t === 'task') return 'task';
  if (t === 'story') return 'story';
  if (t === 'enhancement') return 'story';
  return 'task';
}

function defaultRules() {
  return {
    createFromIssues: true,
    createFromUnlinkedPrs: true,
    sprintReadyLabel: 'sprint-ready',
    labelMappings: {
      bug: 'bug',
      enhancement: 'story',
      task: 'task',
    },
  };
}

function parseRulesPayload(payload) {
  const base = defaultRules();
  const inMap = payload?.labelMappings && typeof payload.labelMappings === 'object' ? payload.labelMappings : {};

  const mapped = {};
  for (const [key, value] of Object.entries(inMap)) {
    const k = safeText(key).toLowerCase();
    if (!k) continue;
    mapped[k] = normalizeTaskType(value);
  }

  return {
    createFromIssues: payload?.createFromIssues !== undefined ? Boolean(payload.createFromIssues) : base.createFromIssues,
    createFromUnlinkedPrs: payload?.createFromUnlinkedPrs !== undefined ? Boolean(payload.createFromUnlinkedPrs) : base.createFromUnlinkedPrs,
    sprintReadyLabel: safeText(payload?.sprintReadyLabel || base.sprintReadyLabel).toLowerCase(),
    labelMappings: {
      ...base.labelMappings,
      ...mapped,
    },
  };
}

function inferTaskType(labels, mappings) {
  const list = Array.isArray(labels) ? labels : [];
  for (const l of list) {
    const name = safeText(l?.name || l).toLowerCase();
    if (!name) continue;
    if (mappings[name]) return normalizeTaskType(mappings[name]);
    if (name === 'bug') return 'bug';
    if (name === 'enhancement') return 'story';
    if (name === 'task') return 'task';
  }
  return 'task';
}

function derivePriority(labels) {
  const list = Array.isArray(labels) ? labels : [];
  const names = list.map((l) => safeText(l?.name || l).toLowerCase());
  if (names.includes('critical') || names.includes('p0')) return 'critical';
  if (names.includes('high') || names.includes('p1')) return 'high';
  if (names.includes('low') || names.includes('p3')) return 'low';
  return 'medium';
}

function parsePrSummary(prTitle, prBody) {
  const title = safeText(prTitle);
  const body = safeText(prBody);
  const combined = `${title}\n${body}`.toLowerCase();

  let type = 'task';
  if (combined.includes('[bug]') || combined.includes('fix:') || combined.includes('bug')) type = 'bug';
  if (combined.includes('[story]') || combined.includes('feat:') || combined.includes('enhancement')) type = 'story';

  const storyPointsMatch = combined.match(/\b(?:sp|story\s*points?)\s*[:=]\s*(\d{1,2})\b/i);
  const storyPoints = storyPointsMatch ? Number(storyPointsMatch[1]) : 0;

  const cleanTitle = title.replace(/^\[(bug|story|task)\]\s*/i, '').trim();
  return {
    title: cleanTitle || 'PR Task',
    description: body || null,
    type,
    storyPoints: Number.isFinite(storyPoints) ? storyPoints : 0,
  };
}

async function getRules(orgPool) {
  try {
    const resp = await orgPool.query(
      `SELECT create_from_issues, create_from_unlinked_prs, sprint_ready_label, label_mappings
       FROM github_auto_task_rules
       ORDER BY created_at ASC
       LIMIT 1`
    );

    const row = resp.rows[0] || null;
    if (!row) return defaultRules();

    return parseRulesPayload({
      createFromIssues: row.create_from_issues,
      createFromUnlinkedPrs: row.create_from_unlinked_prs,
      sprintReadyLabel: row.sprint_ready_label,
      labelMappings: row.label_mappings,
    });
  } catch {
    return defaultRules();
  }
}

async function saveRules(orgPool, payload) {
  const nextRules = parseRulesPayload(payload || {});

  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS github_auto_task_rules (
       id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
       create_from_issues BOOLEAN DEFAULT TRUE,
       create_from_unlinked_prs BOOLEAN DEFAULT TRUE,
       sprint_ready_label VARCHAR(80) DEFAULT 'sprint-ready',
       label_mappings JSONB DEFAULT '{"bug":"bug","enhancement":"story","task":"task"}',
       created_at TIMESTAMP DEFAULT NOW(),
       updated_at TIMESTAMP DEFAULT NOW()
     )`
  );

  await orgPool.query('BEGIN');
  try {
    const existing = await orgPool.query('SELECT id FROM github_auto_task_rules ORDER BY created_at ASC LIMIT 1');

    if (existing.rows[0]?.id) {
      await orgPool.query(
        `UPDATE github_auto_task_rules
         SET create_from_issues = $1,
             create_from_unlinked_prs = $2,
             sprint_ready_label = $3,
             label_mappings = $4::jsonb,
             updated_at = NOW()
         WHERE id = $5`,
        [
          nextRules.createFromIssues,
          nextRules.createFromUnlinkedPrs,
          nextRules.sprintReadyLabel,
          JSON.stringify(nextRules.labelMappings),
          String(existing.rows[0].id),
        ]
      );
    } else {
      await orgPool.query(
        `INSERT INTO github_auto_task_rules (
           create_from_issues,
           create_from_unlinked_prs,
           sprint_ready_label,
           label_mappings
         ) VALUES ($1,$2,$3,$4::jsonb)`,
        [
          nextRules.createFromIssues,
          nextRules.createFromUnlinkedPrs,
          nextRules.sprintReadyLabel,
          JSON.stringify(nextRules.labelMappings),
        ]
      );
    }

    await orgPool.query('COMMIT');
    return nextRules;
  } catch (err) {
    try {
      await orgPool.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
}

async function findProjectByRepo(orgPool, repoName) {
  const repo = safeText(repoName).toLowerCase();
  if (!repo) return null;

  const resp = await orgPool.query(
    `SELECT id, name
     FROM projects
     WHERE LOWER(github_repo) = $1
     LIMIT 1`,
    [repo]
  );

  return resp.rows[0] || null;
}

async function findExistingBacklogByIssue(orgPool, projectId, issueNumber) {
  const resp = await orgPool.query(
    `SELECT id, sprint_id
     FROM backlog_items
     WHERE project_id = $1
       AND github_issue_number = $2
     LIMIT 1`,
    [String(projectId), Number(issueNumber)]
  );
  return resp.rows[0] || null;
}

async function findTaskByIssue(orgPool, projectId, issueNumber) {
  const resp = await orgPool.query(
    `SELECT id, sprint_id
     FROM tasks
     WHERE project_id = $1
       AND github_issue_number = $2
     LIMIT 1`,
    [String(projectId), Number(issueNumber)]
  );
  return resp.rows[0] || null;
}

async function findCurrentSprint(orgPool, projectId) {
  const active = await orgPool.query(
    `SELECT id
     FROM sprints
     WHERE project_id = $1
       AND status = 'active'
     ORDER BY start_date DESC NULLS LAST
     LIMIT 1`,
    [String(projectId)]
  );

  if (active.rows[0]?.id) return active.rows[0];

  const fallback = await orgPool.query(
    `SELECT id
     FROM sprints
     WHERE project_id = $1
       AND status IN ('planning', 'active')
     ORDER BY start_date DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [String(projectId)]
  );

  return fallback.rows[0] || null;
}

async function createBacklogFromIssue(orgPool, repoName, payload, rules) {
  const issue = payload?.issue || {};
  const issueNumber = Number(issue?.number || 0);
  const project = await findProjectByRepo(orgPool, repoName);
  if (!project || !Number.isFinite(issueNumber) || issueNumber <= 0) return null;

  const existing = await findExistingBacklogByIssue(orgPool, project.id, issueNumber);
  if (existing) return { backlogItemId: existing.id, created: false, projectId: project.id };

  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  const type = inferTaskType(labels, rules.labelMappings);
  const priority = derivePriority(labels);
  const techTags = labels.map((l) => safeText(l?.name || l)).filter(Boolean);

  const resp = await orgPool.query(
    `INSERT INTO backlog_items (
       project_id,
       title,
       description,
       type,
       priority,
       status,
       tech_tags,
       github_issue_number,
       github_issue_url
     ) VALUES ($1,$2,$3,$4,$5,'backlog',$6,$7,$8)
     RETURNING id`,
    [
      String(project.id),
      safeText(issue?.title) || `Issue #${issueNumber}`,
      safeText(issue?.body) || null,
      type,
      priority,
      techTags,
      issueNumber,
      safeText(issue?.html_url) || null,
    ]
  );

  return { backlogItemId: resp.rows[0]?.id || null, created: true, projectId: project.id };
}

async function moveBacklogToSprint(orgPool, backlogItemId, sprintId, projectId, issueNumber) {
  await orgPool.query('BEGIN');
  try {
    await orgPool.query(
      `UPDATE backlog_items
       SET sprint_id = $2,
           status = 'in_sprint',
           updated_at = NOW()
       WHERE id = $1`,
      [String(backlogItemId), String(sprintId)]
    );

    const backlog = await orgPool.query(
      `SELECT id, title, description, type, priority, story_points, tech_tags, acceptance_criteria, github_issue_number, github_issue_url
       FROM backlog_items
       WHERE id = $1
       LIMIT 1`,
      [String(backlogItemId)]
    );

    const b = backlog.rows[0];
    const task = await orgPool.query(
      `INSERT INTO tasks (
         backlog_item_id,
         sprint_id,
         project_id,
         title,
         description,
         type,
         priority,
         status,
         story_points,
         tech_tags,
         acceptance_criteria,
         github_issue_number,
         github_issue_url
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'todo',$8,$9,$10,$11,$12)
       ON CONFLICT (project_id, github_issue_number) DO UPDATE SET
         sprint_id = EXCLUDED.sprint_id,
         backlog_item_id = EXCLUDED.backlog_item_id,
         project_id = EXCLUDED.project_id,
         updated_at = NOW()
       RETURNING id`,
      [
        String(b.id),
        String(sprintId),
        String(projectId),
        String(b.title),
        b.description || null,
        b.type || 'task',
        b.priority || 'medium',
        Number(b.story_points || 0),
        b.tech_tags || [],
        b.acceptance_criteria || null,
        Number(b.github_issue_number || issueNumber),
        b.github_issue_url || null,
      ]
    );

    await orgPool.query('COMMIT');
    return { taskId: task.rows[0]?.id || null };
  } catch (err) {
    try {
      await orgPool.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
}

async function handleIssueOpened(orgPool, repoName, payload) {
  const rules = await getRules(orgPool);
  if (!rules.createFromIssues) return { created: false, skipped: 'rule_disabled' };
  return createBacklogFromIssue(orgPool, repoName, payload, rules);
}

async function handleIssueLabeled(orgPool, repoName, payload) {
  const rules = await getRules(orgPool);
  if (!rules.createFromIssues) return { moved: false, skipped: 'rule_disabled' };

  const issue = payload?.issue || {};
  const labelName = safeText(payload?.label?.name).toLowerCase();
  if (!labelName || labelName !== safeText(rules.sprintReadyLabel).toLowerCase()) {
    return { moved: false, skipped: 'label_not_configured' };
  }

  const issueNumber = Number(issue?.number || 0);
  const project = await findProjectByRepo(orgPool, repoName);
  if (!project || !Number.isFinite(issueNumber) || issueNumber <= 0) return { moved: false, skipped: 'project_or_issue_missing' };

  const sprint = await findCurrentSprint(orgPool, project.id);
  if (!sprint?.id) return { moved: false, skipped: 'no_active_sprint' };

  const existingTask = await findTaskByIssue(orgPool, project.id, issueNumber);
  if (existingTask?.id) {
    await orgPool.query(
      `UPDATE tasks
       SET sprint_id = $2,
           status = CASE WHEN status = 'todo' THEN 'todo' ELSE status END,
           updated_at = NOW()
       WHERE id = $1`,
      [String(existingTask.id), String(sprint.id)]
    );
    return { moved: true, taskId: existingTask.id, sprintId: sprint.id };
  }

  let backlog = await findExistingBacklogByIssue(orgPool, project.id, issueNumber);
  if (!backlog?.id) {
    const created = await createBacklogFromIssue(orgPool, repoName, payload, rules);
    backlog = created?.backlogItemId ? { id: created.backlogItemId } : null;
  }
  if (!backlog?.id) return { moved: false, skipped: 'backlog_not_found' };

  const moved = await moveBacklogToSprint(orgPool, backlog.id, sprint.id, project.id, issueNumber);
  return { moved: true, taskId: moved.taskId, sprintId: sprint.id };
}

async function createTaskFromUnlinkedPr(orgPool, repoName, payload) {
  const rules = await getRules(orgPool);
  if (!rules.createFromUnlinkedPrs) return { created: false, skipped: 'rule_disabled' };

  const project = await findProjectByRepo(orgPool, repoName);
  if (!project) return { created: false, skipped: 'project_not_mapped' };

  const sprint = await findCurrentSprint(orgPool, project.id);
  if (!sprint?.id) return { created: false, skipped: 'no_active_sprint' };

  const pr = payload?.pull_request || {};
  const prNumber = Number(pr?.number || payload?.number || 0);

  const existing = await orgPool.query(
    `SELECT id
     FROM tasks
     WHERE project_id = $1
       AND github_pr_number = $2
     LIMIT 1`,
    [String(project.id), Number(prNumber)]
  );
  if (existing.rows[0]?.id) return { created: false, taskId: existing.rows[0].id, skipped: 'already_exists' };

  const parsed = parsePrSummary(pr?.title, pr?.body);
  const issueNumMatch = safeText(pr?.title).match(/#(\d+)/);
  const githubIssueNumber = issueNumMatch ? Number(issueNumMatch[1]) : null;

  const task = await orgPool.query(
    `INSERT INTO tasks (
       sprint_id,
       project_id,
       title,
       description,
       type,
       priority,
       status,
       story_points,
       tech_tags,
       github_pr_number,
       github_pr_url,
       github_issue_number,
       github_issue_url
     ) VALUES ($1,$2,$3,$4,$5,'medium','in_progress',$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      String(sprint.id),
      String(project.id),
      parsed.title,
      parsed.description,
      parsed.type,
      Number(parsed.storyPoints || 0),
      [],
      Number(prNumber),
      safeText(pr?.html_url) || null,
      githubIssueNumber,
      githubIssueNumber ? `https://github.com/${safeText(repoName)}/issues/${githubIssueNumber}` : null,
    ]
  );

  await orgPool.query(
    `INSERT INTO task_comments (task_id, author_id, content, comment_type, metadata)
     VALUES ($1, NULL, $2, 'comment', $3::jsonb)`,
    [
      String(task.rows[0].id),
      'Auto-created from unlinked GitHub pull request.',
      JSON.stringify({ source: 'github', prNumber: Number(prNumber), repo: safeText(repoName) }),
    ]
  );

  return { created: true, taskId: task.rows[0].id, sprintId: sprint.id, projectId: project.id };
}

class GithubAutoTaskService {
  async getRules(orgPool) {
    return getRules(orgPool);
  }

  async saveRules(orgPool, payload) {
    return saveRules(orgPool, payload);
  }

  async handleIssueOpened(orgPool, repoName, payload) {
    return handleIssueOpened(orgPool, repoName, payload);
  }

  async handleIssueLabeled(orgPool, repoName, payload) {
    return handleIssueLabeled(orgPool, repoName, payload);
  }

  async createTaskFromUnlinkedPr(orgPool, repoName, payload) {
    return createTaskFromUnlinkedPr(orgPool, repoName, payload);
  }
}

const githubAutoTaskService = new GithubAutoTaskService();

module.exports = {
  GithubAutoTaskService,
  githubAutoTaskService,
};
