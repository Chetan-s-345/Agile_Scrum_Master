const axios = require('axios');
const { env } = require('./env');

class NeonApiError extends Error {
  constructor(message, { status, data } = {}) {
    super(message);
    this.name = 'NeonApiError';
    this.status = status;
    this.data = data;
  }
}

class ProjectCreationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProjectCreationError';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetries(fn, { retries = 3, baseDelayMs = 300 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      // Don't retry non-retryable client errors (except rate limiting).
      const status = err?.status;
      if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
        throw err;
      }
      lastErr = err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  throw lastErr;
}

function sanitizeProjectNamePart(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .replace(/-+/g, '-');
  return slug || 'org';
}

function buildNeonProjectName({ orgId, orgSlug }) {
  const idPart = String(orgId || '').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'unknown';
  const slugPart = sanitizeProjectNamePart(orgSlug);

  // Keep comfortably under common name length limits.
  const prefix = 'org-';
  const suffix = `-${idPart}`;
  const maxTotal = 60;
  const maxSlugLen = Math.max(1, maxTotal - prefix.length - suffix.length);
  const trimmedSlug = slugPart.slice(0, maxSlugLen).replace(/-+$/g, '') || 'org';

  return `${prefix}${trimmedSlug}${suffix}`;
}

async function pollUntilReady(getStateFn, { intervalMs = 2000, timeoutMs = 60000 } = {}) {
  const startedAt = Date.now();
  // Neon state fields can vary; we treat "ready" or "active" as ready.
  while (Date.now() - startedAt < timeoutMs) {
    const state = await getStateFn();
    const normalized = String(state || '').toLowerCase();
    if (normalized === 'ready' || normalized === 'active') return;
    await sleep(intervalMs);
  }
  throw new ProjectCreationError('Timed out waiting for Neon project to become ready');
}

class NeonProjectManager {
  constructor({ orgId } = {}) {
    const explicitOrgId = orgId ? String(orgId).trim() : '';
    this.orgId = explicitOrgId || (env.NEON_ORG_ID ? String(env.NEON_ORG_ID).trim() : null);
    const apiKey = env.NEON_API_KEY || env.NEON_ORG_KEY;
    this.client = axios.create({
      baseURL: 'https://console.neon.tech/api/v2',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  _requestConfig(orgIdOverride = null) {
    const orgId = orgIdOverride || this.orgId;
    return orgId ? { params: { org_id: orgId } } : undefined;
  }

  async _resolveOrgIdForProjectCreate() {
    if (this.orgId) return this.orgId;

    try {
      // 1) Try /users/me first (often works without org_id and can contain a default organization id)
      let meResp = null;
      try {
        meResp = await withRetries(async () => {
          try {
            return await this.client.get('/users/me');
          } catch (e) {
            const status = e?.response?.status;
            // If Forbidden, we can gracefully fall through because Org keys can't access /users/me
            if (status === 403 || status === 401) return null;
            const data = e?.response?.data;
            throw new NeonApiError('Failed to fetch Neon user profile', { status, data });
          }
        });
      } catch {
        // Ignore errors and try the next step.
      }

      if (meResp) {
        const me = meResp?.data?.user || meResp?.data || null;
        const meOrgId = me?.default_organization_id || me?.organization_id || me?.org_id;
        if (meOrgId) {
          this.orgId = String(meOrgId);
          return this.orgId;
        }
      }

      // 2) Try listing projects without org_id and infer a unique org id.
      // Users frequently can call GET /projects even when org_id is required for creation.
      let projectsResp = null;
      try {
        projectsResp = await withRetries(async () => {
          try {
            return await this.client.get('/projects');
          } catch (e) {
            const status = e?.response?.status;
            if (status === 403) return null;
            const data = e?.response?.data;
            throw new NeonApiError('Failed to list Neon projects', { status, data });
          }
        });
      } catch {
        // Ignore errors and try the next step.
      }

      if (projectsResp) {
        const projects = Array.isArray(projectsResp?.data?.projects) ? projectsResp.data.projects : [];
        const inferredOrgIds = projects
          .map((p) => p?.org_id || p?.organization_id || p?.project?.org_id || p?.project?.organization_id)
          .filter(Boolean)
          .map((id) => String(id));

        const uniqueOrgIds = Array.from(new Set(inferredOrgIds));
        if (uniqueOrgIds.length === 1) {
          this.orgId = uniqueOrgIds[0];
          return this.orgId;
        }
      }

      // 3) Try listing organizations explicitly.
      let orgsResp = null;
      try {
        orgsResp = await withRetries(async () => {
          try {
            return await this.client.get('/users/me/organizations');
          } catch (e) {
            const status = e?.response?.status;
            if (status === 403) return null;
            const data = e?.response?.data;
            throw new NeonApiError('Failed to list Neon organizations', { status, data });
          }
        });
      } catch {
        // Ignore fallback errors
      }

      if (orgsResp) {
        const organizations = Array.isArray(orgsResp?.data?.organizations) ? orgsResp.data.organizations : [];
        const ids = organizations
          .map((o) => o?.id || o?.org_id)
          .filter(Boolean)
          .map((id) => String(id));

        if (ids.length === 1) {
          this.orgId = ids[0];
          return this.orgId;
        }
        if (ids.length > 1) {
          throw new ProjectCreationError(
            'NEON_ORG_ID is required when your Neon account has multiple organizations. Set NEON_ORG_ID in backend/api-gateway/.env.'
          );
        }
      }

      throw new ProjectCreationError('NEON_ORG_ID is required. No organizations were returned for the provided Neon API key.');
    } catch (err) {
      const status = err?.status;
      const msg = String(err?.data?.message || err?.message || '').toLowerCase();
      if ((status === 403 || status === 404) && msg.includes('organization api keys') && msg.includes('not allowed')) {
        throw new ProjectCreationError('NEON_ORG_ID is required when using NEON_ORG_KEY. Set NEON_ORG_ID in backend/api-gateway/.env.');
      }
      throw err;
    }
  }

  async _getProjectConnectionUriViaApi(projectId) {
    const resp = await withRetries(async () => {
      try {
        // Neon can usually return a default connection URI for the project's primary branch.
        return await this.client.get(`/projects/${String(projectId)}/connection_uri`, this._requestConfig());
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        throw new NeonApiError('Failed to fetch project connection URI', { status, data });
      }
    });

    const uri = resp?.data?.uri;
    if (!uri) throw new NeonApiError('Project connection URI not found');
    return uri;
  }

  async getProjectConnectionString(projectId) {
    return this._getProjectConnectionUriViaApi(projectId);
  }

  async _pollOperations(projectId, operations) {
    const ops = Array.isArray(operations) ? operations : [];
    const opIds = ops
      .map((op) => op?.id)
      .filter(Boolean)
      .map((id) => String(id));
    if (!opIds.length) return;

    const isDone = (status) => {
      const s = String(status || '').toLowerCase();
      return s === 'finished' || s === 'succeeded' || s === 'success' || s === 'completed' || s === 'done';
    };
    const isFailed = (status) => {
      const s = String(status || '').toLowerCase();
      return s === 'failed' || s === 'error' || s === 'canceled' || s === 'cancelled';
    };

    for (const opId of opIds) {
      await pollUntilReady(async () => {
        const resp = await withRetries(async () => {
          try {
            return await this.client.get(
              `/projects/${String(projectId)}/operations/${String(opId)}`,
              this._requestConfig()
            );
          } catch (e) {
            const status = e?.response?.status;
            const data = e?.response?.data;
            throw new NeonApiError('Failed polling Neon operation status', { status, data });
          }
        });
        const status = resp?.data?.operation?.status || resp?.data?.status;
        if (isFailed(status)) {
          throw new ProjectCreationError(`Neon operation failed (operationId=${opId})`);
        }
        return isDone(status) ? 'ready' : status;
      });
    }
  }

  async createOrgProject(orgId, orgSlug) {
    const projectName = buildNeonProjectName({ orgId, orgSlug });
    const regionId = env.NEON_REGION_ID ? String(env.NEON_REGION_ID).trim() : null;
    const requestOrgId = await this._resolveOrgIdForProjectCreate();

    if (!requestOrgId) {
      throw new ProjectCreationError('NEON_ORG_ID is required for project creation. Set NEON_ORG_ID in backend/api-gateway/.env.');
    }

    const createResp = await withRetries(async () => {
      try {
        return await this.client.post(
          '/projects',
          {
            project: {
              name: projectName,
              org_id: String(requestOrgId),
              ...(regionId ? { region_id: regionId } : {}),
            },
          },
          this._requestConfig(requestOrgId)
        );
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        throw new NeonApiError('Failed to create Neon project', { status, data });
      }
    });

    const projectId = createResp?.data?.project?.id;
    if (!projectId) throw new ProjectCreationError('Neon project creation response missing project id');

    await this._pollOperations(projectId, createResp?.data?.operations);

    const connFromArray = createResp?.data?.connection_uris?.[0]?.connection_uri || createResp?.data?.connection_uris?.[0]?.uri;
    const connFromDirect = createResp?.data?.connection_uri || createResp?.data?.connectionUri || createResp?.data?.uri;
    let connectionString = connFromArray || connFromDirect || null;

    if (!connectionString) {
      connectionString = await this._getProjectConnectionUriViaApi(projectId);
    }

    let host = null;
    try {
      const u = new URL(String(connectionString));
      host = u.host || null;
    } catch {
      host = null;
    }

    return {
      projectId: String(projectId),
      projectName,
      connectionString: String(connectionString),
      host,
      orgId: String(requestOrgId),
    };
  }

  async deleteProject(projectId) {
    await withRetries(async () => {
      try {
        await this.client.delete(`/projects/${String(projectId)}`, this._requestConfig());
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        throw new NeonApiError('Failed to delete project', { status, data });
      }
    });
  }
}

module.exports = {
  NeonProjectManager,
  NeonApiError,
  ProjectCreationError,
};
