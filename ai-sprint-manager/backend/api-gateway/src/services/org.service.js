const { db } = require('../config/database');
const { env } = require('../config/env');
const { NeonBranchManager } = require('../config/neon');

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
}

class OrgService {
  constructor() {
    this.neon = env.TENANT_DB_PROVISIONING_MODE === 'neon' ? new NeonBranchManager() : null;
    this._orgColumns = null;
  }

  async _loadOrgColumns() {
    if (this._orgColumns) return this._orgColumns;
    const resp = await db.universalPool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizations'"
    );
    this._orgColumns = new Set(resp.rows.map((r) => r.column_name));
    return this._orgColumns;
  }

  async _orgHasColumn(columnName) {
    const cols = await this._loadOrgColumns();
    return cols.has(columnName);
  }

  async createOrgWithNeonBranch({ name, slug }) {
    if (!this.neon) {
      throw Object.assign(new Error('Neon provisioning is disabled on this server'), { statusCode: 400 });
    }

    const orgName = String(name || '').trim();
    const orgSlug = slugify(slug || orgName);
    if (!orgName) throw Object.assign(new Error('Organization name is required'), { statusCode: 400 });
    if (!orgSlug) throw Object.assign(new Error('Organization slug is required'), { statusCode: 400 });

    const created = await db.universalPool.query(
      'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug',
      [orgName, orgSlug]
    );
    const org = created.rows[0];

    try {
      const branch = await this.neon.createOrgBranch(org.id, org.slug);
      const connectionString = branch.connectionString;

      const hasNeonBranchId = await this._orgHasColumn('neon_branch_id');
      const hasConn = await this._orgHasColumn('db_connection_string');
      const hasDbHost = await this._orgHasColumn('db_host');
      const hasDbName = await this._orgHasColumn('db_name');
      const hasProvisioned = await this._orgHasColumn('db_provisioned');

      if (hasNeonBranchId || hasConn) {
        const sets = [];
        const params = [];
        let i = 1;
        if (hasNeonBranchId) {
          sets.push(`neon_branch_id = $${i++}`);
          params.push(branch.branchId);
        }
        if (hasConn) {
          sets.push(`db_connection_string = $${i++}`);
          params.push(connectionString);
        }
        params.push(org.id);
        await db.universalPool.query(`UPDATE organizations SET ${sets.join(', ')} WHERE id = $${i}`, params);
      }

      // Back-compat with init.sql fields
      if (hasDbHost || hasDbName || hasProvisioned) {
        const sets = [];
        const params = [];
        let i = 1;
        if (hasDbHost) {
          sets.push(`db_host = $${i++}`);
          params.push(branch.host);
        }
        if (hasDbName) {
          sets.push(`db_name = $${i++}`);
          params.push(`org_${String(org.id).replace(/-/g, '')}_db`);
        }
        if (hasProvisioned) {
          sets.push(`db_provisioned = $${i++}`);
          params.push(true);
        }
        if (sets.length) {
          params.push(org.id);
          await db.universalPool.query(`UPDATE organizations SET ${sets.join(', ')} WHERE id = $${i}`, params);
        }
      }

      return { ...org, neonBranchId: branch.branchId, dbConnectionString: connectionString };
    } catch (err) {
      await db.universalPool.query('DELETE FROM organizations WHERE id = $1', [org.id]);
      throw err;
    }
  }

  async getOrgById(orgId) {
    const resp = await db.universalPool.query(
      'SELECT id, name, slug, neon_branch_id, created_at FROM organizations WHERE id = $1',
      [String(orgId)]
    );
    return resp.rows[0] || null;
  }
}

const orgService = new OrgService();

module.exports = { OrgService, orgService, slugify }; 
