const axios = require('axios');
const { randomUUID } = require('node:crypto');
const { upsertEmbedding, chunkText } = require('./embeddings');
const { logger } = require('../../src/middleware/logger');

const ingestJobs = new Map();

function safe(value) {
  return String(value || '').trim();
}

function githubHttp(token) {
  const accessToken = safe(token);
  if (!accessToken) throw new Error('GitHub access token is required.');

  return axios.create({
    baseURL: 'https://api.github.com',
    timeout: 30000,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'agile-scrum-master-github-ingestion',
    },
  });
}

function parseAccessToken(rawValue) {
  if (!rawValue) return '';
  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    const token = safe(parsed?.accessToken);
    if (token) return token;
  } catch {
    // Fallback to raw value below.
  }
  return safe(rawValue);
}

async function getStoredGithubAccessToken(orgPool) {
  const resp = await orgPool.query(
    `SELECT access_token_enc
     FROM github_integration
     WHERE is_active = TRUE
     ORDER BY created_at ASC
     LIMIT 1`
  );
  const row = resp.rows[0] || null;
  const token = parseAccessToken(row?.access_token_enc);
  if (!token) throw new Error('GitHub integration token is missing.');
  return token;
}

function ensureJob(jobId) {
  const job = ingestJobs.get(jobId);
  if (!job) throw new Error('Ingestion job not found.');
  return job;
}

function createIngestJob({ projectId, owner, repo }) {
  const jobId = randomUUID();
  ingestJobs.set(jobId, {
    jobId,
    projectId: safe(projectId),
    owner: safe(owner),
    repo: safe(repo),
    status: 'running',
    progress: 'queued',
    startedAt: new Date().toISOString(),
    endedAt: null,
    error: null,
    summary: null,
  });
  return jobId;
}

function getIngestJob(jobId) {
  return ingestJobs.get(String(jobId)) || null;
}

function setJobProgress(jobId, progress) {
  const job = ensureJob(jobId);
  job.progress = safe(progress);
  ingestJobs.set(jobId, job);
}

function finalizeJob(jobId, status, extra = {}) {
  const job = ensureJob(jobId);
  job.status = status;
  job.endedAt = new Date().toISOString();
  job.summary = extra.summary || null;
  job.error = extra.error || null;
  if (extra.progress) job.progress = safe(extra.progress);
  ingestJobs.set(jobId, job);
}

async function ingestReadme(projectId, owner, repo, token) {
  const gh = githubHttp(token);
  const response = await gh.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`);
  const encoded = safe(response?.data?.content).replace(/\n/g, '');
  const content = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
  if (!safe(content)) return { readmeChunks: 0 };

  await upsertEmbedding({
    sourceType: 'readme',
    sourceId: `${owner}/${repo}`,
    projectId: safe(projectId),
    content,
    metadata: { owner: safe(owner), repo: safe(repo), path: safe(response?.data?.path || 'README.md') },
  });

  return { readmeChunks: chunkText(content).length };
}

async function ingestIssues(projectId, owner, repo, token) {
  const gh = githubHttp(token);
  let page = 1;
  let issueCount = 0;

  while (true) {
    const response = await gh.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
      params: { state: 'all', per_page: 100, page },
    });
    const items = Array.isArray(response.data) ? response.data : [];
    if (!items.length) break;

    for (const issue of items) {
      if (issue?.pull_request) continue;
      const labels = Array.isArray(issue.labels) ? issue.labels.map((l) => safe(l?.name)).filter(Boolean).join(', ') : '';
      const content = `Issue #${issue.number}: ${safe(issue.title)}\n${safe(issue.body)}\nState: ${safe(issue.state)}\nLabels: ${labels}`;

      await upsertEmbedding({
        sourceType: 'issue',
        sourceId: `${owner}/${repo}#${issue.number}`,
        projectId: safe(projectId),
        content,
        metadata: {
          number: Number(issue.number),
          state: safe(issue.state),
          url: safe(issue.html_url),
          owner: safe(owner),
          repo: safe(repo),
        },
      });
      issueCount += 1;
    }

    if (items.length < 100) break;
    page += 1;
  }

  return { issueCount };
}

async function ingestPullRequests(projectId, owner, repo, token) {
  const gh = githubHttp(token);
  let page = 1;
  let prCount = 0;

  while (true) {
    const response = await gh.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
      params: { state: 'closed', per_page: 100, page },
    });
    const prs = Array.isArray(response.data) ? response.data : [];
    if (!prs.length) break;

    for (const pr of prs) {
      if (!pr?.merged_at) continue;
      const content = `PR #${pr.number}: ${safe(pr.title)}\n${safe(pr.body)}\nBranch: ${safe(pr?.head?.ref)}`;

      await upsertEmbedding({
        sourceType: 'pr',
        sourceId: `${owner}/${repo}#${pr.number}`,
        projectId: safe(projectId),
        content,
        metadata: {
          number: Number(pr.number),
          url: safe(pr.html_url),
          mergedAt: safe(pr.merged_at),
          owner: safe(owner),
          repo: safe(repo),
        },
      });
      prCount += 1;
    }

    if (prs.length < 100) break;
    page += 1;
  }

  return { prCount };
}

async function ingestCommits(projectId, owner, repo, token) {
  const gh = githubHttp(token);
  let commitCount = 0;

  for (let page = 1; page <= 2; page += 1) {
    const response = await gh.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`, {
      params: { per_page: 100, page },
    });
    const commits = Array.isArray(response.data) ? response.data : [];
    if (!commits.length) break;

    for (const commit of commits) {
      const message = safe(commit?.commit?.message);
      const authorName = safe(commit?.commit?.author?.name) || safe(commit?.author?.login) || 'unknown';
      const authorDate = safe(commit?.commit?.author?.date);
      const content = `Commit: ${message}\nAuthor: ${authorName}\nDate: ${authorDate}`;

      await upsertEmbedding({
        sourceType: 'commit',
        sourceId: safe(commit.sha),
        projectId: safe(projectId),
        content,
        metadata: {
          sha: safe(commit.sha),
          url: safe(commit.html_url),
          owner: safe(owner),
          repo: safe(repo),
        },
      });
      commitCount += 1;
    }

    if (commits.length < 100) break;
  }

  return { commitCount };
}

async function ingestFullRepo(projectId, owner, repo, token, progressCallback) {
  const mark = (message) => {
    logger.info({ projectId, owner, repo, progress: message }, 'GitHub ingestion progress');
    if (typeof progressCallback === 'function') progressCallback(message);
  };

  mark('Ingesting README...');
  const readme = await ingestReadme(projectId, owner, repo, token);
  mark('Ingesting README... done (1/4)');

  mark('Ingesting issues...');
  const issues = await ingestIssues(projectId, owner, repo, token);
  mark('Ingesting issues... done (2/4)');

  mark('Ingesting pull requests...');
  const prs = await ingestPullRequests(projectId, owner, repo, token);
  mark('Ingesting pull requests... done (3/4)');

  mark('Ingesting commits...');
  const commits = await ingestCommits(projectId, owner, repo, token);
  mark('Ingesting commits... done (4/4)');

  return {
    readmeChunks: Number(readme.readmeChunks || 0),
    issueCount: Number(issues.issueCount || 0),
    prCount: Number(prs.prCount || 0),
    commitCount: Number(commits.commitCount || 0),
  };
}

async function runIngestJob({ jobId, projectId, owner, repo, token }) {
  try {
    setJobProgress(jobId, 'running');
    const summary = await ingestFullRepo(projectId, owner, repo, token, (progress) => setJobProgress(jobId, progress));
    finalizeJob(jobId, 'done', { progress: 'completed', summary });
  } catch (error) {
    logger.error({ err: error, jobId, projectId, owner, repo }, 'GitHub ingestion job failed');
    finalizeJob(jobId, 'failed', {
      progress: 'failed',
      error: safe(error?.message || String(error)),
      summary: null,
    });
  }
}

async function clearRepoEmbeddings(projectId) {
  const { Pool } = require('pg');
  const url = process.env.UNIVERSAL_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Missing UNIVERSAL_DATABASE_URL or DATABASE_URL for embedding cleanup.');

  const pool = new Pool({ connectionString: String(url), ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(
      `DELETE FROM embeddings
       WHERE project_id = $1
         AND source_type = ANY($2::text[])`,
      [safe(projectId), ['readme', 'issue', 'pr', 'commit']]
    );
  } finally {
    await pool.end();
  }
}

async function resolveSprintName(orgPool, sprintId) {
  if (!orgPool || !sprintId) return '';
  try {
    const resp = await orgPool.query('SELECT name FROM sprints WHERE id = $1 LIMIT 1', [String(sprintId)]);
    return safe(resp.rows[0]?.name);
  } catch {
    return '';
  }
}

async function embedTaskContent({ task, orgPool }) {
  if (!task) return;
  const projectId = safe(task.project_id || task.projectId);
  const sourceId = safe(task.id);
  if (!projectId || !sourceId) return;

  const sprintName = safe(task.sprint_name || task.sprintName) || (await resolveSprintName(orgPool, task.sprint_id || task.sprintId));
  const code = safe(task.code || task.task_code || task.taskCode || task.id);
  const content = [
    `Task ${code}: ${safe(task.title)}`,
    safe(task.description),
    `Status: ${safe(task.status)}`,
    `Priority: ${safe(task.priority)}`,
    `Sprint: ${sprintName || 'N/A'}`,
  ].join('\n');

  await upsertEmbedding({
    sourceType: 'task',
    sourceId,
    projectId,
    content,
    metadata: { sprintName: sprintName || null },
  });
}

async function embedSprintContent({ sprint }) {
  if (!sprint) return;
  const projectId = safe(sprint.project_id || sprint.projectId);
  const sourceId = safe(sprint.id);
  if (!projectId || !sourceId) return;

  const start = safe(sprint.start_date || sprint.startDate);
  const end = safe(sprint.end_date || sprint.endDate);
  const content = [
    `Sprint: ${safe(sprint.name)}`,
    `Goal: ${safe(sprint.goal)}`,
    `Dates: ${start || 'N/A'} to ${end || 'N/A'}`,
    `Status: ${safe(sprint.status)}`,
  ].join('\n');

  await upsertEmbedding({
    sourceType: 'sprint',
    sourceId,
    projectId,
    content,
    metadata: { status: safe(sprint.status) },
  });
}

function queueEmbedTask(args) {
  void embedTaskContent(args).catch((error) => {
    logger.error({ err: error, taskId: safe(args?.task?.id) }, 'Task embedding failed');
  });
}

function queueEmbedSprint(args) {
  void embedSprintContent(args).catch((error) => {
    logger.error({ err: error, sprintId: safe(args?.sprint?.id) }, 'Sprint embedding failed');
  });
}

module.exports = {
  ingestReadme,
  ingestIssues,
  ingestPullRequests,
  ingestCommits,
  ingestFullRepo,
  createIngestJob,
  getIngestJob,
  runIngestJob,
  clearRepoEmbeddings,
  getStoredGithubAccessToken,
  queueEmbedTask,
  queueEmbedSprint,
};
