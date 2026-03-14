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

class BranchCreationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BranchCreationError';
  }
}

class BranchNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BranchNotFoundError';
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
  // Neon branch state fields can vary; we treat "ready" or "active" as ready.
  while (Date.now() - startedAt < timeoutMs) {
    const state = await getStateFn();
    const normalized = String(state || '').toLowerCase();
    if (normalized === 'ready' || normalized === 'active') return;
    await sleep(intervalMs);
  }
  throw new BranchCreationError('Timed out waiting for Neon branch to become ready');
}

class NeonBranchManager {
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

  _getRoleAndDatabaseNames() {
    const roleName = env.NEON_ROLE_NAME;
    const databaseName = env.NEON_DATABASE_NAME;
    if (roleName && databaseName) return { roleName, databaseName };

    try {
      const derived = deriveRoleAndDatabaseFromConnectionString(env.UNIVERSAL_DATABASE_URL);
      if (derived.roleName && derived.databaseName) return derived;
    } catch {
      // ignore parse failures
    }

    throw new NeonApiError(
      'Unable to derive Neon role/database names. Set NEON_ROLE_NAME and NEON_DATABASE_NAME (or ensure UNIVERSAL_DATABASE_URL is a Neon Postgres URL).'
    );
  }

  async _getBranchConnectionUriViaApi(branchId) {
    const { roleName, databaseName } = this._getRoleAndDatabaseNames();

    const resp = await withRetries(async () => {
      try {
        return await this.client.get(`/projects/${env.NEON_PROJECT_ID}/connection_uri`, {
          params: {
            branch_id: String(branchId),
            database_name: String(databaseName),
            role_name: String(roleName),
          },
        });
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        throw new NeonApiError('Failed to fetch branch connection URI', { status, data });
      }
    });

    const uri = resp?.data?.uri;
    if (!uri) throw new NeonApiError('Branch connection URI not found');
    return uri;
  }

  async getBranchConnectionString(branchId) {
    const endpoints = await this._listBranchEndpoints(branchId);
    const rw = endpoints.find((ep) => ep.type === 'read_write') || endpoints[0];
    const connectionString = rw?.connection_uri || rw?.connectionUri;

    // Newer Neon API responses for endpoints may omit connection_uri entirely.
    // In that case, ask Neon to generate a connection URI for the branch.
    if (!connectionString) {
      return this._getBranchConnectionUriViaApi(branchId);
    }

    return connectionString;
  }

  async _listBranchEndpoints(branchId) {
    const resp = await withRetries(async () => {
      try {
        return await this.client.get(`/projects/${env.NEON_PROJECT_ID}/branches/${branchId}/endpoints`);
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        throw new NeonApiError('Failed to list branch endpoints', { status, data });
      }
    });
    return resp?.data?.endpoints || [];
  }

  async _getReadWriteEndpointId(branchId) {
    const endpoints = await this._listBranchEndpoints(branchId);
    const rw = endpoints.find((ep) => ep.type === 'read_write') || endpoints[0];
    const endpointId = rw?.id;
    if (!endpointId) throw new NeonApiError('Endpoint id not found');
    return endpointId;
  }

  async createOrgBranch(orgId, orgSlug) {
    const branchName = `org-${orgSlug}-${String(orgId).slice(0, 8)}`;

    const createResp = await withRetries(async () => {
      try {
        return await this.client.post(`/projects/${env.NEON_PROJECT_ID}/branches`, {
          branch: {
            name: branchName,
            parent_id: env.NEON_BASE_BRANCH_ID,
          },
          endpoints: [{ type: 'read_write', autoscaling_limit_min_cu: 0.25 }],
        });
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        throw new NeonApiError('Failed to create Neon branch', { status, data });
      }
    });

    const branchId = createResp?.data?.branch?.id;
    if (!branchId) throw new BranchCreationError('Neon branch creation response missing branch id');

    await pollUntilReady(async () => {
      const resp = await withRetries(async () => {
        try {
          return await this.client.get(`/projects/${env.NEON_PROJECT_ID}/branches/${branchId}`);
        } catch (e) {
          const status = e?.response?.status;
          const data = e?.response?.data;
          throw new NeonApiError('Failed polling branch status', { status, data });
        }
      });
      return resp?.data?.branch?.state;
    });

    // Connection details are returned differently depending on endpoint creation.
    const endpoints = createResp?.data?.endpoints || [];
    const firstEndpoint = endpoints[0];
    const connectionString =
      firstEndpoint?.connection_uri ||
      firstEndpoint?.connectionUri ||
      createResp?.data?.connection_uri ||
      null;
    const host = firstEndpoint?.host || null;

    // If connection string is missing, generate it via the API.
    const finalConn = connectionString || (await this._getBranchConnectionUriViaApi(branchId));

    return { branchId, branchName, connectionString: finalConn, host };
  }

  async listAllBranches() {
    const resp = await withRetries(async () => {
      try {
        return await this.client.get(`/projects/${env.NEON_PROJECT_ID}/branches`);
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        throw new NeonApiError('Failed to list branches', { status, data });
      }
    });

    const branches = resp?.data?.branches || [];
    return branches.map((b) => ({
      branchId: b.id,
      name: b.name,
      orgId: (() => {
        const m = String(b.name || '').match(/-([a-f0-9]{8})$/i);
        return m ? m[1] : null;
      })(),
      createdAt: b.created_at,
      state: b.state,
    }));
  }

  async getOrgConnectionString(orgId) {
    const branches = await this.listAllBranches();
    const suffix = String(orgId).slice(0, 8);
    const match = branches.find((b) => String(b.name || '').includes(suffix));
    if (!match) throw new BranchNotFoundError(`No branch found for org ${orgId}`);

    return this.getBranchConnectionString(match.branchId);
  }

  async deleteBranch(branchId) {
    await withRetries(async () => {
      try {
        await this.client.delete(`/projects/${env.NEON_PROJECT_ID}/branches/${branchId}`);
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        throw new NeonApiError('Failed to delete branch', { status, data });
      }
    });
  }

  async suspendBranch(branchId) {
    const endpointId = await this._getReadWriteEndpointId(branchId);
    await withRetries(async () => {
      try {
        await this.client.post(`/projects/${env.NEON_PROJECT_ID}/branches/${branchId}/endpoints/${endpointId}/suspend`);
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        throw new NeonApiError('Failed to suspend endpoint', { status, data });
      }
    });
  }

  async resumeBranch(branchId) {
    const endpointId = await this._getReadWriteEndpointId(branchId);
    await withRetries(async () => {
      try {
        await this.client.post(`/projects/${env.NEON_PROJECT_ID}/branches/${branchId}/endpoints/${endpointId}/resume`);
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        throw new NeonApiError('Failed to resume endpoint', { status, data });
      }
    });
  }

  async getBranchMetrics(branchId) {
    const resp = await withRetries(async () => {
      try {
        return await this.client.get(`/projects/${env.NEON_PROJECT_ID}/branches/${branchId}/metrics`);
      } catch (e) {
        const status = e?.response?.status;
        const data = e?.response?.data;
        throw new NeonApiError('Failed to fetch branch metrics', { status, data });
      }
    });
    return resp?.data;
  }
}

module.exports = {
  NeonBranchManager,
  NeonApiError,
  BranchCreationError,
  BranchNotFoundError,
};
