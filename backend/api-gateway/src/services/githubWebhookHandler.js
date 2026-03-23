const { taskProgressService } = require('./taskProgressService');
const { prMetricsService } = require('./prMetricsService');
const { githubAutoTaskService } = require('./githubAutoTaskService');

function text(value) {
  return String(value || '').trim();
}

function jiraKeyFromText(value) {
  const m = text(value).match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  return m ? m[1] : null;
}

async function findDeveloperIdByGithubUsername(orgPool, username) {
  if (!username) return null;
  const resp = await orgPool.query(
    `SELECT dp.id
     FROM developer_profiles dp
     JOIN team_members tm ON tm.id = dp.member_id
     WHERE tm.github_username IS NOT NULL
       AND LOWER(tm.github_username) = LOWER($1)
     LIMIT 1`,
    [String(username)]
  );
  return resp.rows[0]?.id || null;
}

async function upsertLastEventAt(orgPool) {
  try {
    await orgPool.query(`UPDATE github_integration SET last_event_at = NOW() WHERE is_active = TRUE`);
  } catch {
    // ignore
  }
}

async function insertGithubEvent(orgPool, row) {
  await orgPool.query(
    `INSERT INTO github_events (
       event_type, repo_name, developer_id, task_id,
       github_pr_number, github_commit_sha, branch_name,
       additions, deletions, review_state, event_at, raw_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [
      row.eventType,
      row.repoName || null,
      row.developerId || null,
      row.taskId || null,
      row.prNumber || null,
      row.commitSha || null,
      row.branch || null,
      row.additions || 0,
      row.deletions || 0,
      row.reviewState || null,
      row.eventAt || new Date(),
      JSON.stringify(row.rawPayload || {}),
    ]
  );
}

async function handleCreateEvent(orgPool, payload, repoName) {
  const refType = text(payload?.ref_type).toLowerCase();
  if (refType !== 'branch') return { ok: true, ignored: true };

  const branch = text(payload?.ref);
  const linked = await taskProgressService.resolveTask(orgPool, payload, branch, repoName);

  await insertGithubEvent(orgPool, {
    eventType: 'create',
    repoName,
    taskId: linked.taskId || null,
    branch,
    eventAt: new Date(),
    rawPayload: payload,
  });

  if (linked.taskId) await taskProgressService.onBranchCreated(orgPool, payload);
  return { ok: true, branch, taskId: linked.taskId || null };
}

async function handlePushEvent(orgPool, payload, repoName) {
  const commits = Array.isArray(payload?.commits) ? payload.commits : [];
  const branch = text(payload?.ref).replace(/^refs\/heads\//, '') || null;
  const actor = payload?.sender?.login || payload?.pusher?.name || null;
  const developerId = await findDeveloperIdByGithubUsername(orgPool, actor);

  let linkedTaskId = null;

  for (const commit of commits) {
    const message = text(commit?.message);
    const linked = await taskProgressService.resolveTask(orgPool, payload, `${branch || ''}\n${message}`, repoName);
    const taskId = linked.taskId || null;
    if (taskId) linkedTaskId = taskId;

    await insertGithubEvent(orgPool, {
      eventType: 'push',
      repoName,
      developerId,
      taskId,
      commitSha: commit?.id || null,
      branch,
      eventAt: commit?.timestamp ? new Date(commit.timestamp) : new Date(),
      rawPayload: commit,
    });
  }

  if (linkedTaskId && commits.length > 0) {
    const existing = await orgPool.query(
      `SELECT COUNT(*)::int AS c
       FROM github_events
       WHERE task_id = $1
         AND event_type = 'push'
       LIMIT 100000`,
      [String(linkedTaskId)]
    );

    if (Number(existing.rows[0]?.c || 0) === 1) {
      await taskProgressService.onFirstCommitPushed(orgPool, payload);
    }
  }

  if (developerId && commits.length) {
    await orgPool.query(
      `UPDATE developer_profiles
       SET total_commits = total_commits + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [commits.length, developerId]
    );
  }

  return { ok: true, commits: commits.length, taskId: linkedTaskId };
}

async function handlePullRequestEvent(orgPool, payload, repoName) {
  const action = text(payload?.action).toLowerCase();
  const pr = payload?.pull_request || {};
  const branch = text(pr?.head?.ref) || null;
  const title = text(pr?.title);
  const body = text(pr?.body);

  const linked = await taskProgressService.resolveTask(orgPool, payload, `${branch || ''}\n${title}\n${body}`, repoName);
  let taskId = linked.taskId || null;
  let sprintId = linked.sprintId || null;
  let projectId = linked.projectId || null;
  let createdFromUnlinkedPr = false;

  if (!taskId && action === 'opened') {
    const created = await githubAutoTaskService.createTaskFromUnlinkedPr(orgPool, repoName, payload);
    if (created?.taskId) {
      taskId = created.taskId;
      sprintId = created.sprintId || null;
      projectId = created.projectId || null;
      createdFromUnlinkedPr = true;
    }
  }

  const taskInfo = { taskId, sprintId, projectId };

  const authorLogin = pr?.user?.login || payload?.sender?.login || null;
  const developerId = await findDeveloperIdByGithubUsername(orgPool, authorLogin);

  await insertGithubEvent(orgPool, {
    eventType: 'pull_request',
    repoName,
    developerId,
    taskId,
    prNumber: pr?.number || payload?.number || null,
    branch,
    additions: Number(pr?.additions || 0),
    deletions: Number(pr?.deletions || 0),
    eventAt: pr?.created_at ? new Date(pr.created_at) : new Date(),
    rawPayload: payload,
  });

  await prMetricsService.recordPullRequestEvent(orgPool, payload, taskInfo);

  if (taskId && action === 'opened') {
    await taskProgressService.onPrOpened(orgPool, payload);
    if (!createdFromUnlinkedPr) {
      await orgPool.query(`UPDATE tasks SET status = 'in_review', updated_at = NOW() WHERE id = $1`, [String(taskId)]);
    }
  }

  if (taskId && action === 'review_requested') {
    await taskProgressService.onPrReviewRequested(orgPool, payload);
  }

  const merged = Boolean(pr?.merged) || (action === 'closed' && Boolean(pr?.merged_at));
  if (taskId && merged) {
    await taskProgressService.onPrMerged(orgPool, payload);
    await orgPool.query(
      `INSERT INTO task_comments (task_id, author_id, content, comment_type, metadata)
       VALUES ($1, NULL, $2, 'status_change', $3::jsonb)`,
      [
        String(taskId),
        'PR merged. Task marked done and progress set to 100%.',
        JSON.stringify({ source: 'github', event: 'pr_merged', prUrl: pr?.html_url || null }),
      ]
    );
  }

  return { ok: true, action, taskId };
}

async function handleIssuesEvent(orgPool, payload, repoName) {
  const action = text(payload?.action).toLowerCase();

  if (action === 'opened') {
    const result = await githubAutoTaskService.handleIssueOpened(orgPool, repoName, payload);
    return { ok: true, action, ...result };
  }

  if (action === 'labeled') {
    const result = await githubAutoTaskService.handleIssueLabeled(orgPool, repoName, payload);
    return { ok: true, action, ...result };
  }

  return { ok: true, ignored: true, action };
}

async function handlePullRequestReviewEvent(orgPool, payload, repoName) {
  const review = payload?.review || {};
  const pr = payload?.pull_request || {};
  const branch = text(pr?.head?.ref) || null;
  const reviewer = review?.user?.login || payload?.sender?.login || null;
  const developerId = await findDeveloperIdByGithubUsername(orgPool, reviewer);

  const linked = await taskProgressService.resolveTask(orgPool, payload, `${branch || ''}\n${text(pr?.title)}`, repoName);
  const taskId = linked.taskId || null;
  const taskInfo = { taskId, sprintId: linked.sprintId || null, projectId: linked.projectId || null };

  await insertGithubEvent(orgPool, {
    eventType: 'pull_request_review',
    repoName,
    developerId,
    taskId,
    prNumber: pr?.number || payload?.number || null,
    branch,
    reviewState: text(review?.state) || null,
    eventAt: review?.submitted_at ? new Date(review.submitted_at) : new Date(),
    rawPayload: payload,
  });

  await prMetricsService.recordPullRequestReviewEvent(orgPool, payload, taskInfo);

  if (taskId && text(review?.state).toLowerCase() === 'approved') {
    await taskProgressService.onPrApproved(orgPool, payload);
  }

  if (developerId) {
    await orgPool.query(
      `UPDATE developer_profiles
       SET total_code_reviews = total_code_reviews + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [developerId]
    );
  }

  return { ok: true, taskId };
}

async function handleGithubWebhookEvent(orgPool, eventType, payload) {
  const repoName = text(payload?.repository?.full_name) || text(payload?.repository?.name) || null;
  await upsertLastEventAt(orgPool);

  if (eventType === 'create') return handleCreateEvent(orgPool, payload, repoName);
  if (eventType === 'push') return handlePushEvent(orgPool, payload, repoName);
  if (eventType === 'pull_request') return handlePullRequestEvent(orgPool, payload, repoName);
  if (eventType === 'pull_request_review') return handlePullRequestReviewEvent(orgPool, payload, repoName);
  if (eventType === 'issues') return handleIssuesEvent(orgPool, payload, repoName);

  const key = jiraKeyFromText(text(payload?.head_commit?.message));
  if (key) {
    const linked = await taskProgressService.resolveTask(orgPool, payload, key, repoName);
    return { ok: true, linked: Boolean(linked.taskId), taskId: linked.taskId || null, ignored: true };
  }

  return { ok: true, ignored: true, eventType };
}

module.exports = {
  handleGithubWebhookEvent,
};
