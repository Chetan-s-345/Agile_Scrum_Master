const axios = require('axios');

const { env } = require('../config/env');

function safeText(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return s.trim();
}

function toInt(value, { def, min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

function githubHttp(accessToken) {
  const token = safeText(accessToken);
  if (!token) throw Object.assign(new Error('GitHub access token missing'), { statusCode: 400 });

  return axios.create({
    baseURL: 'https://api.github.com',
    timeout: 30_000,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-sprint-manager-api-gateway',
    },
  });
}

function buildWebhookUrl({ orgId }) {
  const base = safeText(env.PUBLIC_API_GATEWAY_URL).replace(/\/+$/, '');
  if (!base) return null;
  const qp = orgId ? `?orgId=${encodeURIComponent(String(orgId))}` : '';
  return `${base}/api/v1/webhooks/github${qp}`;
}

async function getStoredAccessToken(orgPool) {
  const resp = await orgPool.query(
    `SELECT access_token_enc
     FROM github_integration
     WHERE is_active = TRUE
     ORDER BY created_at ASC
     LIMIT 1`
  );

  const row = resp.rows[0] || null;
  if (!row) {
    throw Object.assign(new Error('GitHub integration not connected'), { statusCode: 400, code: 'GITHUB_NOT_CONNECTED' });
  }

  const raw = row.access_token_enc;
  if (!raw) {
    throw Object.assign(new Error('Stored GitHub token missing'), { statusCode: 400, code: 'GITHUB_TOKEN_MISSING' });
  }

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const token = safeText(parsed?.accessToken);
    if (!token) throw new Error('accessToken missing');
    return token;
  } catch {
    // Back-compat: some rows may store the token directly as string.
    const token = safeText(raw);
    if (!token) {
      throw Object.assign(new Error('Stored GitHub token invalid'), { statusCode: 400, code: 'GITHUB_TOKEN_INVALID' });
    }
    return token;
  }
}

function cacheKey(parts) {
  return parts.map((p) => String(p ?? '')).join('|');
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map();

function getCache(key) {
  const hit = _cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, value) {
  _cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    for (;;) {
      const i = idx;
      idx += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, () => worker());
  await Promise.all(workers);
  return results;
}

async function hasWebhook({ gh, owner, repo, webhookUrl }) {
  if (!webhookUrl) return false;

  try {
    const resp = await gh.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/hooks`, {
      params: { per_page: 100, page: 1 },
    });

    const hooks = Array.isArray(resp.data) ? resp.data : [];
    return hooks.some((h) => safeText(h?.config?.url) === webhookUrl);
  } catch {
    // Missing admin:repo_hook permissions or hooks not accessible.
    return false;
  }
}

function normalizeRepoSummary(repo, { hasWebhook: hook }) {
  return {
    id: repo?.id ?? null,
    name: safeText(repo?.name) || null,
    fullName: safeText(repo?.full_name) || null,
    private: Boolean(repo?.private),
    language: safeText(repo?.language) || null,
    defaultBranch: safeText(repo?.default_branch) || null,
    updatedAt: safeText(repo?.updated_at) || null,
    hasWebhook: Boolean(hook),
  };
}

function asForbidden(detail) {
  return { error: 'Forbidden', code: 403, detail };
}

function isMissingRepoScope(err) {
  const status = err?.response?.status;
  if (status !== 403) return false;
  const msg = safeText(err?.response?.data?.message).toLowerCase();
  return (
    msg.includes('resource not accessible by personal access token') ||
    msg.includes('requires authentication') ||
    msg.includes('insufficient') ||
    msg.includes('must have')
  );
}

async function registerOrUpdateWebhook({ gh, owner, repo, webhookUrl }) {
  if (!webhookUrl) {
    throw Object.assign(new Error('PUBLIC_API_GATEWAY_URL is not set; cannot register webhook'), {
      statusCode: 400,
      code: 'MISSING_PUBLIC_API_GATEWAY_URL',
    });
  }

  const config = {
    url: webhookUrl,
    content_type: 'json',
    ...(env.GITHUB_WEBHOOK_SECRET ? { secret: String(env.GITHUB_WEBHOOK_SECRET) } : {}),
    insecure_ssl: '0',
  };

  const desiredEvents = ['create', 'push', 'pull_request', 'pull_request_review', 'issues'];

  const hooksResp = await gh.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/hooks`, {
    params: { per_page: 100, page: 1 },
  });
  const hooks = Array.isArray(hooksResp.data) ? hooksResp.data : [];
  const existing = hooks.find((h) => safeText(h?.config?.url) === webhookUrl);

  if (existing?.id) {
    const patchResp = await gh.patch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/hooks/${encodeURIComponent(String(existing.id))}`,
      {
        active: true,
        events: desiredEvents,
        config,
      }
    );

    return { attempted: true, registered: true, id: patchResp.data?.id || existing.id, url: webhookUrl };
  }

  const createResp = await gh.post(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/hooks`, {
    name: 'web',
    active: true,
    events: desiredEvents,
    config,
  });

  return { attempted: true, registered: true, id: createResp.data?.id || null, url: webhookUrl };
}

async function listRepos(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const orgId = req.user?.orgId || null;

    const page = toInt(req.query.page, { def: 1, min: 1, max: 1000 });
    const perPage = toInt(req.query.per_page, { def: 20, min: 1, max: 100 });
    const allRepos = safeText(req.query.all) === '1';
    const languageFilter = safeText(req.query.language).toLowerCase() || '';

    const key = cacheKey(['repos', orgId, page, perPage, languageFilter, allRepos ? 'all' : 'paged']);
    const cached = getCache(key);
    if (cached) return res.status(200).json(cached);

    const accessToken = await getStoredAccessToken(orgPool);
    const gh = githubHttp(accessToken);

    let repos = [];
    try {
      if (allRepos) {
        const maxPages = 20;
        for (let ghPage = 1; ghPage <= maxPages; ghPage += 1) {
          const reposResp = await gh.get('/user/repos', {
            params: {
              per_page: 100,
              page: ghPage,
              sort: 'updated',
              direction: 'desc',
              visibility: 'all',
              affiliation: 'owner,collaborator,organization_member',
            },
          });
          const pageItems = Array.isArray(reposResp.data) ? reposResp.data : [];
          repos.push(...pageItems);
          if (pageItems.length < 100) break;
        }
      } else {
        const reposResp = await gh.get('/user/repos', {
          params: {
            per_page: 100,
            page: 1,
            sort: 'updated',
            direction: 'desc',
            visibility: 'all',
            affiliation: 'owner,collaborator,organization_member',
          },
        });
        repos = Array.isArray(reposResp.data) ? reposResp.data : [];
      }
    } catch (err) {
      if (isMissingRepoScope(err)) {
        return res
          .status(403)
          .json(asForbidden('GitHub token lacks repository access. Ensure the PAT includes repo scope (classic) and is authorized.'));
      }

      const status = err?.response?.status;
      if (status === 401) {
        return res.status(401).json({ error: 'Unauthorized', code: 401, detail: 'Stored GitHub token is invalid or expired.' });
      }

      throw err;
    }

    if (languageFilter) {
      repos = repos.filter((r) => safeText(r?.language).toLowerCase() === languageFilter);
    }

    const start = (page - 1) * perPage;
    const end = start + perPage;
    const paged = repos.slice(start, end);

    const webhookUrl = buildWebhookUrl({ orgId });

    const enriched = await mapWithConcurrency(paged, 5, async (r) => {
      const fullName = safeText(r?.full_name);
      const [owner, repo] = fullName.split('/');
      const hook = owner && repo ? await hasWebhook({ gh, owner, repo, webhookUrl }) : false;
      return normalizeRepoSummary(r, { hasWebhook: hook });
    });

    setCache(key, enriched);
    return res.status(200).json(enriched);
  } catch (err) {
    return next(err);
  }
}

async function getRepo(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const owner = safeText(req.params.owner);
    const repo = safeText(req.params.repo);
    if (!owner || !repo) return res.status(400).json({ error: 'Missing owner/repo', code: 400, detail: 'Provide :owner and :repo' });

    const orgId = req.user?.orgId || null;
    const key = cacheKey(['repo', orgId, owner, repo]);
    const cached = getCache(key);
    if (cached) return res.status(200).json(cached);

    const accessToken = await getStoredAccessToken(orgPool);
    const gh = githubHttp(accessToken);

    let repoResp;
    try {
      repoResp = await gh.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    } catch (err) {
      if (isMissingRepoScope(err)) {
        return res
          .status(403)
          .json(asForbidden('GitHub token lacks repository access. Ensure the PAT includes repo scope (classic) and is authorized.'));
      }
      const status = err?.response?.status;
      if (status === 404) return res.status(404).json({ error: 'Not found', code: 404, detail: 'Repository not found or not accessible.' });
      if (status === 401) return res.status(401).json({ error: 'Unauthorized', code: 401, detail: 'Stored GitHub token is invalid or expired.' });
      throw err;
    }

    const webhookUrl = buildWebhookUrl({ orgId });
    const hook = await hasWebhook({ gh, owner, repo, webhookUrl });

    const out = normalizeRepoSummary(repoResp.data, { hasWebhook: hook });
    setCache(key, out);

    return res.status(200).json(out);
  } catch (err) {
    return next(err);
  }
}

async function connectRepo(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const owner = safeText(req.params.owner);
    const repo = safeText(req.params.repo);
    if (!owner || !repo) return res.status(400).json({ error: 'Missing owner/repo', code: 400, detail: 'Provide :owner and :repo' });

    const orgId = req.user?.orgId || null;
    const accessToken = await getStoredAccessToken(orgPool);
    const gh = githubHttp(accessToken);

    const webhookUrl = buildWebhookUrl({ orgId });

    try {
      const webhook = await registerOrUpdateWebhook({ gh, owner, repo, webhookUrl });

      // Bust caches for this org.
      for (const k of _cache.keys()) {
        if (k.startsWith(cacheKey(['repo', orgId, owner, repo])) || k.startsWith(cacheKey(['repos', orgId]))) {
          _cache.delete(k);
        }
      }

      return res.status(200).json({ ok: true, webhook });
    } catch (err) {
      if (isMissingRepoScope(err)) {
        return res
          .status(403)
          .json(asForbidden('GitHub token lacks permissions to manage webhooks. Ensure the PAT includes repo + admin:repo_hook scopes.'));
      }

      const status = err?.response?.status;
      if (status === 403) {
        return res
          .status(403)
          .json(asForbidden('GitHub token lacks permissions to manage webhooks for this repo (need admin:repo_hook on classic PAT).'));
      }
      if (status === 404) {
        return res.status(404).json({ error: 'Not found', code: 404, detail: 'Repository not found or not accessible.' });
      }

      throw err;
    }
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listRepos,
  getRepo,
  connectRepo,
};
