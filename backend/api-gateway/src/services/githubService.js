const axios = require('axios');

const { env } = require('../config/env');

function normalizeBaseUrl(baseUrl) {
  const u = String(baseUrl || '').trim().replace(/\/+$/, '');
  return u;
}

function githubHttp(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) throw Object.assign(new Error('accessToken is required'), { statusCode: 400 });

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
  const base = normalizeBaseUrl(env.PUBLIC_API_GATEWAY_URL);
  if (!base) {
    throw Object.assign(
      new Error('PUBLIC_API_GATEWAY_URL is required to register GitHub webhooks'),
      {
        statusCode: 400,
        code: 'MISSING_PUBLIC_API_GATEWAY_URL',
        publicMessage:
          'Set PUBLIC_API_GATEWAY_URL for the api-gateway so it can register a public webhook callback URL.',
      }
    );
  }

  const qp = orgId ? `?orgId=${encodeURIComponent(String(orgId))}` : '';
  return `${base}/api/v1/webhooks/github${qp}`;
}

class GithubService {
  constructor() {
    this.http = axios.create({ timeout: 30_000 });
  }

  async connect({ githubOrg, repoName, accessToken, orgId, createIfMissing, visibility, description }, orgPool) {
    const org = String(githubOrg || '').trim();
    const repo = String(repoName || '').trim();
    if (!org || !repo) throw Object.assign(new Error('githubOrg and repoName are required'), { statusCode: 400 });

    const gh = githubHttp(accessToken);

    // Validate token + repo access
    let repoResp;
    try {
      repoResp = await gh.get(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404 && createIfMissing) {
        try {
          repoResp = await gh.post(`/orgs/${encodeURIComponent(org)}/repos`, {
            name: repo,
            description: description ? String(description) : undefined,
            visibility: visibility ? String(visibility) : undefined,
          });
        } catch (createErr) {
          const createStatus = createErr?.response?.status;
          throw Object.assign(
            new Error(
              createStatus === 404
                ? 'GitHub organization not found (cannot create org via API)'
                : 'Failed to create repository in GitHub organization'
            ),
            {
              statusCode: 400,
              details: {
                hint:
                  'GitHub org creation is not supported via API for personal tokens. Create the org in GitHub UI first, then retry with a token that has repo + webhook permissions.',
                githubOrg: org,
                repoName: repo,
              },
            }
          );
        }
      } else {
        throw err;
      }
    }

    const repoFullName = String(repoResp?.data?.full_name || `${org}/${repo}`);

    // Upsert single active row
    await orgPool.query('BEGIN');
    try {
      const existing = await orgPool.query('SELECT id FROM github_integration ORDER BY created_at ASC LIMIT 1');
      if (existing.rows.length) {
        await orgPool.query(
          `UPDATE github_integration
           SET github_org = $1,
               repo_name = $2,
               access_token_enc = $3,
               is_active = TRUE,
               created_at = created_at
           WHERE id = $4`,
          [org, repo, JSON.stringify({ accessToken }), String(existing.rows[0].id)]
        );
      } else {
        await orgPool.query(
          `INSERT INTO github_integration (github_org, repo_name, access_token_enc, is_active)
           VALUES ($1,$2,$3,TRUE)`,
          [org, repo, JSON.stringify({ accessToken })]
        );
      }

      await orgPool.query('COMMIT');
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }

    let webhook = { attempted: false };
    try {
      const callbackUrl = buildWebhookUrl({ orgId });
      webhook = await this._registerOrUpdateWebhook({ gh, org, repo, callbackUrl });
    } catch (e) {
      // If PUBLIC_API_GATEWAY_URL isn't configured, skip webhook registration.
      webhook = { attempted: false, reason: String(e?.message || e) };
    }

    return {
      connected: true,
      repoFullName,
      webhook,
    };
  }

  async _registerOrUpdateWebhook({ gh, org, repo, callbackUrl }) {
    const config = {
      url: callbackUrl,
      content_type: 'json',
      ...(env.GITHUB_WEBHOOK_SECRET ? { secret: String(env.GITHUB_WEBHOOK_SECRET) } : {}),
      insecure_ssl: '0',
    };

    const desiredEvents = ['create', 'push', 'pull_request', 'pull_request_review', 'issues'];

    // Try to find an existing hook for this callback URL.
    const hooksResp = await gh.get(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/hooks`);
    const hooks = Array.isArray(hooksResp.data) ? hooksResp.data : [];
    const existing = hooks.find((h) => String(h?.config?.url || '') === callbackUrl);

    if (existing?.id) {
      const patchResp = await gh.patch(
        `/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/hooks/${encodeURIComponent(String(existing.id))}`,
        {
          active: true,
          events: desiredEvents,
          config,
        }
      );

      return { attempted: true, registered: true, id: patchResp.data?.id || existing.id, url: callbackUrl };
    }

    const createResp = await gh.post(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/hooks`, {
      name: 'web',
      active: true,
      events: desiredEvents,
      config,
    });

    return { attempted: true, registered: true, id: createResp.data?.id || null, url: callbackUrl };
  }

  async getStatus(orgPool) {
    const resp = await orgPool.query('SELECT * FROM github_integration WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
    const integ = resp.rows[0] || null;
    if (!integ) return { connected: false };

    return {
      connected: Boolean(integ.is_active),
      githubOrg: integ.github_org,
      repoName: integ.repo_name,
      lastEventAt: integ.last_event_at,
      webhookConfigured: Boolean(env.GITHUB_WEBHOOK_SECRET),
      publicGatewayUrlConfigured: Boolean(env.PUBLIC_API_GATEWAY_URL),
    };
  }
}

const githubService = new GithubService();

module.exports = {
  GithubService,
  githubService,
};
