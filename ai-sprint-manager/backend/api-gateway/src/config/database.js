const { Pool } = require('pg');
const { env } = require('./env');
const { logger } = require('../middleware/logger');
const { NeonBranchManager } = require('./neon');

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
    this.neon = env.TENANT_DB_PROVISIONING_MODE === 'neon' ? new NeonBranchManager() : null;
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

    // Optional fallback: derive connection string from Neon (only in neon mode).
    if (!conn && this.neon) {
      conn = await this.neon.getOrgConnectionString(key);

      // Best-effort persist for next time if the universal schema supports it.
      if (hasConnCol) {
        await this.universalPool.query(
          'UPDATE organizations SET db_connection_string = $1 WHERE id = $2 AND (db_connection_string IS NULL OR db_connection_string = \'\')',
          [conn, key]
        );
      }
    }

    if (!conn) {
      throw Object.assign(new Error('Org DB connection string not found. In manual mode, you must store organizations.db_connection_string for this org.'), {
        statusCode: 500,
      });
    }

    const pool = poolFromConnectionString(conn, { max: 10 });
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
