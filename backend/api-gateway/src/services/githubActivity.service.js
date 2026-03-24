const axios = require('axios');

function requireOrgDb(req) {
  if (!req.orgDb) throw Object.assign(new Error('Org DB not attached'), { statusCode: 500 });
  return req.orgDb;
}

function safe(v) {
  return String(v || '').trim();
}

function parseRepo(fullName) {
  const [owner, repo] = String(fullName || '').split('/');
  if (!owner || !repo) return null;
  return { owner, repo, fullName: `${owner}/${repo}` };
}

function cacheKey(parts) {
  return parts.map((v) => String(v || '')).join('|');
}

const CACHE = new Map();

function getCache(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, ttlMs, value) {
  CACHE.set(key, { exp: Date.now() + ttlMs, value });
}

const TTLS = {
  overview: 2 * 60 * 1000,
  commits: 5 * 60 * 1000,
  prs: 2 * 60 * 1000,
  issues: 2 * 60 * 1000,
  workflows: 60 * 1000,
  branches: 5 * 60 * 1000,
};

async function getStoredAccessToken(orgPool) {
  const resp = await orgPool.query(
    `SELECT access_token_enc FROM github_integration WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1`
  );
  const row = resp.rows[0] || null;
  if (!row?.access_token_enc) {
    throw Object.assign(new Error('GitHub integration not connected'), { statusCode: 400, code: 'GITHUB_NOT_CONNECTED' });
  }

  try {
    const parsed = typeof row.access_token_enc === 'string' ? JSON.parse(row.access_token_enc) : row.access_token_enc;
    const token = safe(parsed?.accessToken);
    if (token) return token;
  } catch {
    // ignore
  }

  const raw = safe(row.access_token_enc);
  if (!raw) throw Object.assign(new Error('GitHub token invalid'), { statusCode: 400 });
  return raw;
}

function githubHttp(accessToken) {
  return axios.create({
    baseURL: 'https://api.github.com',
    timeout: 30_000,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-sprint-manager-api-gateway',
    },
  });
}

function errorFromGithub(err) {
  const status = err?.response?.status;
  const message = safe(err?.response?.data?.message);
  const rateRemaining = err?.response?.headers?.['x-ratelimit-remaining'];
  const rateReset = err?.response?.headers?.['x-ratelimit-reset'];

  if (status === 401) {
    const e = Object.assign(new Error('GitHub token expired or revoked'), { statusCode: 401, code: 'GITHUB_TOKEN_EXPIRED' });
    return e;
  }
  if (status === 403 && String(rateRemaining) === '0') {
    const e = Object.assign(new Error('GitHub API rate limit exceeded'), {
      statusCode: 429,
      code: 'GITHUB_RATE_LIMIT',
      resetAt: rateReset ? new Date(Number(rateReset) * 1000).toISOString() : null,
    });
    return e;
  }
  return Object.assign(new Error(message || 'GitHub API request failed'), { statusCode: status || 502 });
}

async function linkedRepos(orgPool) {
  const merged = new Set();

  const projectRows = await orgPool.query(
    `SELECT TRIM(github_repo) AS full_name
     FROM projects
     WHERE github_repo IS NOT NULL AND TRIM(github_repo) <> ''`
  );

  for (const row of projectRows.rows) {
    const parsed = parseRepo(row.full_name);
    if (parsed) merged.add(parsed.fullName);
  }

  try {
    const goalRepoRows = await orgPool.query(
      `SELECT TRIM(gr.full_name) AS full_name
       FROM goal_repos gpr
       JOIN github_repos gr ON gr.id = gpr.repo_id
       WHERE gr.full_name IS NOT NULL AND TRIM(gr.full_name) <> ''`
    );

    for (const row of goalRepoRows.rows) {
      const parsed = parseRepo(row.full_name);
      if (parsed) merged.add(parsed.fullName);
    }
  } catch (err) {
    if (String(err?.code || '') !== '42P01') throw err;
  }

  return Array.from(merged.values());
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;

  async function worker() {
    for (;;) {
      const idx = i;
      i += 1;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => worker()));
  return out;
}

function sortByTimeDesc(items, pick) {
  return [...items].sort((a, b) => new Date(pick(b)).getTime() - new Date(pick(a)).getTime());
}

function normalizeRepoFilter(repos, repoFilter) {
  const want = safe(repoFilter);
  if (!want || want.toLowerCase() === 'all') return repos;
  return repos.filter((r) => r.toLowerCase() === want.toLowerCase());
}

class GithubActivityService {
  async _context(req) {
    const orgPool = requireOrgDb(req);
    const token = await getStoredAccessToken(orgPool);
    const gh = githubHttp(token);
    const repos = await linkedRepos(orgPool);
    return { orgPool, gh, repos };
  }

  async overview(req) {
    const { gh, repos } = await this._context(req);
    const selectedRepos = normalizeRepoFilter(repos, req.query.repo);
    const key = cacheKey(['overview', selectedRepos.join(','), req.user?.orgId]);
    const cached = getCache(key);
    if (cached) return cached;

    const recentCommits = [];
    const openPrs = [];
    const workflows = [];

    await mapLimit(selectedRepos, 4, async (fullName) => {
      const parsed = parseRepo(fullName);
      if (!parsed) return;

      try {
        const [commitsResp, prsResp, wfResp] = await Promise.all([
          gh.get(`/repos/${parsed.owner}/${parsed.repo}/commits`, { params: { per_page: 10 } }),
          gh.get(`/repos/${parsed.owner}/${parsed.repo}/pulls`, { params: { state: 'open', per_page: 5 } }),
          gh.get(`/repos/${parsed.owner}/${parsed.repo}/actions/runs`, { params: { per_page: 5 } }),
        ]);

        for (const c of commitsResp.data || []) {
          recentCommits.push({
            sha: c.sha,
            message: c.commit?.message || '',
            author: c.commit?.author?.name || c.author?.login || 'unknown',
            avatar: c.author?.avatar_url || null,
            repo: fullName,
            htmlUrl: c.html_url,
            authoredAt: c.commit?.author?.date || c.commit?.committer?.date,
          });
        }

        for (const pr of prsResp.data || []) {
          openPrs.push({
            id: pr.id,
            number: pr.number,
            title: pr.title,
            repo: fullName,
            author: pr.user?.login,
            avatar: pr.user?.avatar_url,
            state: pr.draft ? 'draft' : 'open',
            createdAt: pr.created_at,
            htmlUrl: pr.html_url,
          });
        }

        for (const run of wfResp.data?.workflow_runs || []) {
          workflows.push({
            id: run.id,
            name: run.name,
            repo: fullName,
            branch: run.head_branch,
            status: run.status,
            conclusion: run.conclusion,
            startedAt: run.run_started_at,
            updatedAt: run.updated_at,
            htmlUrl: run.html_url,
          });
        }
      } catch (err) {
        throw errorFromGithub(err);
      }
    });

    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;

    const openIssuesCounts = await mapLimit(selectedRepos, 3, async (fullName) => {
      const parsed = parseRepo(fullName);
      if (!parsed) return 0;
      try {
        const issuesResp = await gh.get(`/repos/${parsed.owner}/${parsed.repo}`);
        return Number(issuesResp.data?.open_issues_count || 0);
      } catch (err) {
        throw errorFromGithub(err);
      }
    });

    const result = {
      metrics: {
        openPrs: openPrs.length,
        openIssues: openIssuesCounts.reduce((acc, n) => acc + Number(n || 0), 0),
        failedWorkflows: workflows.filter((r) => String(r.conclusion || '') === 'failure').length,
        commitsThisWeek: recentCommits.filter((c) => new Date(c.authoredAt || '').getTime() >= weekAgo).length,
      },
      commits: sortByTimeDesc(recentCommits, (c) => c.authoredAt).slice(0, 10),
      pullRequests: sortByTimeDesc(openPrs, (p) => p.createdAt).slice(0, 5),
      workflows: sortByTimeDesc(workflows, (w) => w.startedAt || w.updatedAt).slice(0, 5),
      repos: selectedRepos,
    };

    setCache(key, TTLS.overview, result);
    return result;
  }

  async commits(req) {
    const { gh, repos } = await this._context(req);
    const selectedRepos = normalizeRepoFilter(repos, req.query.repo);
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query.perPage || 20)));
    const key = cacheKey(['commits', selectedRepos.join(','), req.query.branch, req.query.author, req.query.from, req.query.to, page, perPage]);
    const cached = getCache(key);
    if (cached) return cached;

    const commits = [];

    await mapLimit(selectedRepos, 3, async (fullName) => {
      const parsed = parseRepo(fullName);
      if (!parsed) return;
      const params = {
        per_page: Math.min(100, perPage),
        sha: safe(req.query.branch) || undefined,
        author: safe(req.query.author) || undefined,
        since: safe(req.query.from) || undefined,
        until: safe(req.query.to) || undefined,
      };

      try {
        const resp = await gh.get(`/repos/${parsed.owner}/${parsed.repo}/commits`, { params });
        for (const c of resp.data || []) {
          commits.push({
            sha: c.sha,
            message: c.commit?.message || '',
            author: c.commit?.author?.name || c.author?.login || 'unknown',
            avatar: c.author?.avatar_url || null,
            repo: fullName,
            branch: safe(req.query.branch) || 'default',
            htmlUrl: c.html_url,
            authoredAt: c.commit?.author?.date || c.commit?.committer?.date,
          });
        }
      } catch (err) {
        throw errorFromGithub(err);
      }
    });

    const sorted = sortByTimeDesc(commits, (c) => c.authoredAt);
    const start = (page - 1) * perPage;
    const items = sorted.slice(start, start + perPage).map((c) => ({
      ...c,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
    }));

    const result = { items, total: sorted.length, page, perPage };
    setCache(key, TTLS.commits, result);
    return result;
  }

  async pullRequests(req) {
    const { gh, repos, orgPool } = await this._context(req);
    const selectedRepos = normalizeRepoFilter(repos, req.query.repo);
    const status = safe(req.query.status) || 'open';
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query.perPage || 20)));
    const key = cacheKey(['prs', selectedRepos.join(','), status, req.query.author, req.query.label, page, perPage]);
    const cached = getCache(key);
    if (cached) return cached;

    const all = [];

    await mapLimit(selectedRepos, 3, async (fullName) => {
      const parsed = parseRepo(fullName);
      if (!parsed) return;

      try {
        const resp = await gh.get(`/repos/${parsed.owner}/${parsed.repo}/pulls`, {
          params: { state: status === 'draft' ? 'open' : status, per_page: 100 },
        });

        for (const pr of resp.data || []) {
          if (status === 'draft' && !pr.draft) continue;
          if (safe(req.query.author) && safe(req.query.author).toLowerCase() !== safe(pr.user?.login).toLowerCase()) continue;
          if (safe(req.query.label)) {
            const labels = Array.isArray(pr.labels) ? pr.labels.map((l) => safe(l.name).toLowerCase()) : [];
            if (!labels.includes(safe(req.query.label).toLowerCase())) continue;
          }

          const linkedTask = await orgPool.query(
            `SELECT id, title FROM tasks WHERE github_pr_number = $1 ORDER BY created_at DESC LIMIT 1`,
            [Number(pr.number)]
          );

          all.push({
            id: pr.id,
            number: pr.number,
            title: pr.title,
            repo: fullName,
            baseBranch: pr.base?.ref || '',
            headBranch: pr.head?.ref || '',
            author: pr.user?.login,
            avatar: pr.user?.avatar_url,
            labels: Array.isArray(pr.labels) ? pr.labels.map((l) => ({ name: l.name, color: l.color })) : [],
            reviewers: Array.isArray(pr.requested_reviewers)
              ? pr.requested_reviewers.map((r) => ({ login: r.login, avatar: r.avatar_url, status: 'requested' }))
              : [],
            comments: Number(pr.comments || 0),
            changedFiles: Number(pr.changed_files || 0),
            state: pr.draft ? 'draft' : pr.state,
            htmlUrl: pr.html_url,
            createdAt: pr.created_at,
            linkedTask: linkedTask.rows[0] ? { id: linkedTask.rows[0].id, title: linkedTask.rows[0].title } : null,
          });
        }
      } catch (err) {
        throw errorFromGithub(err);
      }
    });

    const sorted = sortByTimeDesc(all, (x) => x.createdAt);
    const start = (page - 1) * perPage;
    const result = { items: sorted.slice(start, start + perPage), total: sorted.length, page, perPage };
    setCache(key, TTLS.prs, result);
    return result;
  }

  async issues(req) {
    const { gh, repos } = await this._context(req);
    const selectedRepos = normalizeRepoFilter(repos, req.query.repo);
    const status = safe(req.query.status) || 'open';
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query.perPage || 20)));
    const key = cacheKey(['issues', selectedRepos.join(','), status, req.query.label, req.query.assignee, page, perPage]);
    const cached = getCache(key);
    if (cached) return cached;

    const all = [];

    await mapLimit(selectedRepos, 3, async (fullName) => {
      const parsed = parseRepo(fullName);
      if (!parsed) return;
      try {
        const resp = await gh.get(`/repos/${parsed.owner}/${parsed.repo}/issues`, {
          params: {
            state: status === 'all' ? 'all' : status,
            labels: safe(req.query.label) || undefined,
            assignee: safe(req.query.assignee) || undefined,
            per_page: 100,
          },
        });

        for (const issue of resp.data || []) {
          if (issue.pull_request) continue;
          all.push({
            id: issue.id,
            number: issue.number,
            title: issue.title,
            repo: fullName,
            state: issue.state,
            labels: Array.isArray(issue.labels) ? issue.labels.map((l) => ({ name: l.name, color: l.color })) : [],
            assignees: Array.isArray(issue.assignees) ? issue.assignees.map((a) => ({ login: a.login, avatar: a.avatar_url })) : [],
            comments: Number(issue.comments || 0),
            createdAt: issue.created_at,
            author: issue.user?.login,
            body: issue.body || '',
            htmlUrl: issue.html_url,
          });
        }
      } catch (err) {
        throw errorFromGithub(err);
      }
    });

    const sorted = sortByTimeDesc(all, (x) => x.createdAt);
    const start = (page - 1) * perPage;
    const result = { items: sorted.slice(start, start + perPage), total: sorted.length, page, perPage };
    setCache(key, TTLS.issues, result);
    return result;
  }

  async workflows(req) {
    const { gh, repos } = await this._context(req);
    const selectedRepos = normalizeRepoFilter(repos, req.query.repo);
    const status = safe(req.query.status);
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query.perPage || 20)));
    const key = cacheKey(['workflows', selectedRepos.join(','), status, req.query.workflow, page, perPage]);
    const cached = getCache(key);
    if (cached) return cached;

    const runs = [];

    await mapLimit(selectedRepos, 3, async (fullName) => {
      const parsed = parseRepo(fullName);
      if (!parsed) return;

      try {
        const resp = await gh.get(`/repos/${parsed.owner}/${parsed.repo}/actions/runs`, { params: { per_page: 100 } });
        for (const run of resp.data?.workflow_runs || []) {
          const state = safe(run.status) === 'completed' ? safe(run.conclusion) : safe(run.status);
          if (safe(req.query.workflow) && !safe(run.name).toLowerCase().includes(safe(req.query.workflow).toLowerCase())) continue;
          if (status && status !== 'all') {
            if (status === 'success' && state !== 'success') continue;
            if (status === 'failed' && state !== 'failure') continue;
            if (status === 'running' && safe(run.status) === 'completed') continue;
          }

          runs.push({
            id: run.id,
            workflowName: run.name,
            runNumber: run.run_number,
            repo: fullName,
            branch: run.head_branch,
            status: run.status,
            conclusion: run.conclusion,
            event: run.event,
            actor: run.actor?.login,
            actorAvatar: run.actor?.avatar_url,
            durationSec:
              run.run_started_at && run.updated_at
                ? Math.max(0, Math.floor((new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime()) / 1000))
                : 0,
            startedAt: run.run_started_at,
            htmlUrl: run.html_url,
          });
        }
      } catch (err) {
        throw errorFromGithub(err);
      }
    });

    const sorted = sortByTimeDesc(runs, (r) => r.startedAt);
    const start = (page - 1) * perPage;

    const chart = [];
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date();
      day.setDate(day.getDate() - i);
      const iso = day.toISOString().slice(0, 10);
      const dayRuns = sorted.filter((r) => String(r.startedAt || '').slice(0, 10) === iso);
      chart.push({
        day: iso.slice(5),
        success: dayRuns.filter((r) => r.conclusion === 'success').length,
        failed: dayRuns.filter((r) => r.conclusion === 'failure').length,
        other: dayRuns.filter((r) => r.conclusion !== 'success' && r.conclusion !== 'failure').length,
      });
    }

    const result = { items: sorted.slice(start, start + perPage), total: sorted.length, page, perPage, chart };
    setCache(key, TTLS.workflows, result);
    return result;
  }

  async branches(req) {
    const { gh, repos } = await this._context(req);
    const selectedRepos = normalizeRepoFilter(repos, req.query.repo);
    const search = safe(req.query.search).toLowerCase();
    const key = cacheKey(['branches', selectedRepos.join(','), search]);
    const cached = getCache(key);
    if (cached) return cached;

    const all = [];

    await mapLimit(selectedRepos, 3, async (fullName) => {
      const parsed = parseRepo(fullName);
      if (!parsed) return;

      try {
        const [branchesResp, repoResp] = await Promise.all([
          gh.get(`/repos/${parsed.owner}/${parsed.repo}/branches`, { params: { per_page: 100 } }),
          gh.get(`/repos/${parsed.owner}/${parsed.repo}`),
        ]);

        const defaultBranch = safe(repoResp.data?.default_branch);

        for (const b of branchesResp.data || []) {
          if (search && !safe(b.name).toLowerCase().includes(search)) continue;

          all.push({
            repo: fullName,
            name: b.name,
            protected: Boolean(b.protected),
            isDefault: b.name === defaultBranch,
            ahead: 0,
            behind: 0,
            openPrs: 0,
            lastCommitMessage: '',
            lastCommitAuthor: '',
            lastCommitAt: null,
          });
        }
      } catch (err) {
        throw errorFromGithub(err);
      }
    });

    const result = { items: all };
    setCache(key, TTLS.branches, result);
    return result;
  }

  async importIssueAsTask(req, issueId) {
    const orgPool = requireOrgDb(req);
    const issues = await this.issues({ ...req, query: { ...(req.query || {}), status: 'all', perPage: 200, page: 1 } });
    const target = (issues.items || []).find((x) => String(x.id) === String(issueId));
    if (!target) throw Object.assign(new Error('Issue not found'), { statusCode: 404 });

    const project = await orgPool.query('SELECT id FROM projects WHERE github_repo = $1 LIMIT 1', [target.repo]);
    const projectId = project.rows[0]?.id;
    if (!projectId) throw Object.assign(new Error('No project linked for this repository'), { statusCode: 400 });

    const sprint = await orgPool.query(
      `SELECT id FROM sprints WHERE project_id = $1 AND status IN ('active','planning') ORDER BY start_date DESC LIMIT 1`,
      [String(projectId)]
    );
    const sprintId = sprint.rows[0]?.id;
    if (!sprintId) throw Object.assign(new Error('No active/planning sprint found for project'), { statusCode: 400 });

    const actor = await orgPool.query('SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1', [String(req.user?.userId || '')]);

    const inserted = await orgPool.query(
      `INSERT INTO tasks (project_id, sprint_id, title, description, type, priority, github_issue_number, github_issue_url, tech_tags, created_by)
       VALUES ($1,$2,$3,$4,'task','medium',$5,$6,$7,$8)
       RETURNING id, title`,
      [
        String(projectId),
        String(sprintId),
        String(target.title || 'Imported issue'),
        String(target.body || ''),
        Number(target.number),
        String(target.htmlUrl || ''),
        Array.isArray(target.labels) ? target.labels.map((l) => safe(l.name)).filter(Boolean) : [],
        actor.rows[0]?.id || null,
      ]
    );

    return { task: inserted.rows[0] };
  }

  async linkPrToTask(req, prId, taskId) {
    const orgPool = requireOrgDb(req);
    const prs = await this.pullRequests({ ...req, query: { ...(req.query || {}), status: 'open', page: 1, perPage: 200 } });
    const target = (prs.items || []).find((x) => String(x.id) === String(prId));
    if (!target) throw Object.assign(new Error('PR not found'), { statusCode: 404 });

    const updated = await orgPool.query(
      `UPDATE tasks SET github_pr_number = $1, github_pr_url = $2, updated_at = NOW() WHERE id = $3 RETURNING id, title`,
      [Number(target.number), String(target.htmlUrl || ''), String(taskId)]
    );

    if (!updated.rows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    return { task: updated.rows[0] };
  }

  async deleteBranch(req, repoFullName, branch) {
    const { gh } = await this._context(req);
    const parsed = parseRepo(repoFullName);
    if (!parsed) throw Object.assign(new Error('Invalid repo'), { statusCode: 400 });

    try {
      await gh.delete(`/repos/${parsed.owner}/${parsed.repo}/git/refs/heads/${encodeURIComponent(branch)}`);
      return { ok: true };
    } catch (err) {
      throw errorFromGithub(err);
    }
  }
}

const githubActivityService = new GithubActivityService();

module.exports = { githubActivityService };

