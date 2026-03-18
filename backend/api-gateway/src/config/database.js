const { Pool } = require('pg');
const { env } = require('./env');
const { logger } = require('../middleware/logger');
const { normalizeTenantDbConnectionString } = require('../utils/tenant-db');

function poolFromConnectionString(connectionString, { max } = {}) {
  return new Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });
}

class DatabasePoolManager {
  constructor() {
    this.universalPool = poolFromConnectionString(env.UNIVERSAL_DATABASE_URL, { max: 20 });
    this.orgPools = new Map();
    this._orgColumns = null;
  }

  async _loadOrgColumns() {
    if (this._orgColumns) return this._orgColumns;
    const resp = await this.universalPool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizations'"
    );
    this._orgColumns = new Set(resp.rows.map((r) => r.column_name));
    return this._orgColumns;
  }

  async _orgHasColumn(columnName) {
    const cols = await this._loadOrgColumns();
    return cols.has(columnName);
  }

  async getOrgPool(orgId) {
    const key = String(orgId);
    const existing = this.orgPools.get(key);
    if (existing) return existing;

    let conn = null;
    const hasConnCol = await this._orgHasColumn('db_connection_string');
    if (hasConnCol) {
      const orgRow = await this.universalPool.query(
        'SELECT id, db_connection_string FROM organizations WHERE id = $1',
        [key]
      );
      conn = orgRow?.rows?.[0]?.db_connection_string || null;
    }


    if (!conn) {
      throw Object.assign(
        new Error('Organization database is not provisioned yet. Complete database setup and try again.'),
        {
          statusCode: 409,
          code: 'ORG_DB_NOT_PROVISIONED',
        }
      );
    }

    const normalizedConn = normalizeTenantDbConnectionString(conn);
    if (!normalizedConn) {
      throw Object.assign(new Error('Organization database connection string is empty.'), {
        statusCode: 409,
        code: 'ORG_DB_NOT_PROVISIONED',
      });
    }

    const pool = poolFromConnectionString(normalizedConn, { max: 10 });
    this.orgPools.set(key, pool);
    return pool;
  }

  async releaseOrgPool(orgId) {
    const key = String(orgId);
    const pool = this.orgPools.get(key);
    if (!pool) return;
    await pool.end();
    this.orgPools.delete(key);
  }

  async query(pool, sql, params) {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      logger.error({ err, sql }, 'DB query failed');
      throw err;
    }
  }

  async transaction(pool, callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

const db = new DatabasePoolManager();

module.exports = { DatabasePoolManager, db };
