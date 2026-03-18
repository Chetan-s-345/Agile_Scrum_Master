const axios = require('axios');
const { env } = require('./env');
const { URL } = require('node:url');

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

function deriveRoleAndDatabaseFromConnectionString(connectionString) {
  const u = new URL(String(connectionString));
  const roleName = decodeURIComponent(u.username || '');
  const databaseName = String(u.pathname || '').replace(/^\//, '');
  return { roleName, databaseName };
}

async function withRetries(fn, { retries = 3, baseDelayMs = 300 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  throw lastErr;
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
  constructor() {
    this.client = axios.create({
      baseURL: 'https://console.neon.tech/api/v2',
      headers: {
        Authorization: `Bearer ${env.NEON_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async _getProjectConnectionUriViaApi(projectId) {
    const resp = await withRetries(async () => {
      try {
        // Neon can usually return a default connection URI for the project's primary branch.
        return await this.client.get(`/projects/${String(projectId)}/connection_uri`);
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
            return await this.client.get(`/projects/${String(projectId)}/operations/${String(opId)}`);
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
    const projectName = `org-${orgSlug}-${String(orgId).slice(0, 8)}`;

    const createResp = await withRetries(async () => {
      try {
        return await this.client.post('/projects', {
          project: {
            name: projectName,
          },
        });
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

    return { projectId: String(projectId), projectName, connectionString: String(connectionString), host };
  }

  async deleteProject(projectId) {
    await withRetries(async () => {
      try {
        await this.client.delete(`/projects/${String(projectId)}`);
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
