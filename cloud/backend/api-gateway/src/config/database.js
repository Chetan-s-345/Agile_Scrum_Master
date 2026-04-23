const { Pool } = require('pg');
const { env } = require('./env');
const { logger } = require('../middleware/logger');
const { normalizeTenantDbConnectionString } = require('../utils/tenant-db');

function poolFromConnectionString(connectionString, { max } = {}) {
  return new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });
}

function isRetryableConnectError(err) {
  const code = String(err?.code || '').toUpperCase();
  const message = String(err?.message || '').toLowerCase();
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENETUNREACH' ||
    code === 'EHOSTUNREACH' ||
    message.includes('timedout') ||
    message.includes('timeout') ||
    message.includes('connection terminated') ||
    message.includes('could not connect')
  );
}

async function probePool(pool) {
  await pool.query('SELECT 1');
}

class DatabasePoolManager {
  constructor() {
    this.universalPool = poolFromConnectionString(env.UNIVERSAL_DATABASE_URL, { max: 20 });
    this.orgPools = new Map();
    this.orgPoolEndTimers = new Map();
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
    const pendingEnd = this.orgPoolEndTimers.get(key);
    if (pendingEnd) {
      clearTimeout(pendingEnd);
      this.orgPoolEndTimers.delete(key);
    }

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

    const fallbackConnRaw = String(process.env.FALLBACK_TENANT_DATABASE_URL || '').trim();
    const fallbackConn = normalizeTenantDbConnectionString(fallbackConnRaw || env.UNIVERSAL_DATABASE_URL);
    const allowFallback = String(env.NODE_ENV || '').toLowerCase() !== 'production' && Boolean(fallbackConn);

    const pool = poolFromConnectionString(normalizedConn, { max: 10 });
    try {
      await probePool(pool);
      this.orgPools.set(key, pool);
      return pool;
    } catch (err) {
      try {
        await pool.end();
      } catch {
        // ignore
      }

      if (!allowFallback || !fallbackConn || fallbackConn === normalizedConn || !isRetryableConnectError(err)) {
        throw err;
      }

      logger.warn(
        {
          orgId: key,
          code: err?.code,
          message: err?.message,
        },
        'org_db.primary_connection_failed_using_fallback'
      );

      const fallbackPool = poolFromConnectionString(fallbackConn, { max: 10 });
      await probePool(fallbackPool);
      this.orgPools.set(key, fallbackPool);
      return fallbackPool;
    }
  }

  async releaseOrgPool(orgId, options = {}) {
    const key = String(orgId);
    const pool = this.orgPools.get(key);
    if (!pool) return;
    this.orgPools.delete(key);

    const graceMsRaw = Number(options?.graceMs);
    const graceMs = Number.isFinite(graceMsRaw) && graceMsRaw >= 0 ? graceMsRaw : 15000;

    const timer = setTimeout(async () => {
      this.orgPoolEndTimers.delete(key);
      try {
        await pool.end();
      } catch {
        // ignore end errors for stale pools
      }
    }, graceMs);

    this.orgPoolEndTimers.set(key, timer);
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
