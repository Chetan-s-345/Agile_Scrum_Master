/*
  Adds Jira per-project sync state + sync schedule tables to all tenant org databases.

  Usage:
    node scripts/migrate-add-jira-sync-state-and-schedule.js

  Requirements:
    - UNIVERSAL_DATABASE_URL env var points at universal DB.
    - organizations table must include db_connection_string.
*/

const { Pool } = require('pg');

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env var: ${name}`);
  return String(v).trim();
}

function normalizeTenantDbConnectionString(connectionString) {
  const v = String(connectionString || '').trim();
  return v || null;
}

async function hasColumn(pool, table, column) {
  const resp = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [String(table), String(column)]
  );
  return resp.rows.length > 0;
}

async function tableExists(pool, table) {
  const resp = await pool.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = $1
     LIMIT 1`,
    [String(table)]
  );
  return resp.rows.length > 0;
}

async function migrateOrg(orgId, connStr) {
  const normalized = normalizeTenantDbConnectionString(connStr);
  if (!normalized) return { orgId, ok: false, skipped: true, reason: 'empty_connection_string' };

  const orgPool = new Pool({
    connectionString: normalized,
    max: 1,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await orgPool.query('BEGIN');

    const jiraIntegrationExists = await tableExists(orgPool, 'jira_integration');
    if (!jiraIntegrationExists) {
      await orgPool.query('ROLLBACK');
      return { orgId, ok: false, skipped: true, reason: 'jira_integration_missing' };
    }

    await orgPool.query(
      `CREATE TABLE IF NOT EXISTS jira_project_sync_state (
         id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
         project_key     VARCHAR(50) NOT NULL,
         board_id        VARCHAR(50) NOT NULL DEFAULT '',
         last_synced_at  TIMESTAMP,
         last_mode       VARCHAR(30),
         last_status     VARCHAR(30),
         last_error      TEXT,
         updated_at      TIMESTAMP DEFAULT NOW(),
         UNIQUE(project_key, board_id)
       )`
    );

    await orgPool.query(
      `CREATE TABLE IF NOT EXISTS jira_sync_schedule (
         id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
         enabled         BOOLEAN DEFAULT FALSE,
         project_key     VARCHAR(50),
         board_id        VARCHAR(50),
         mode            VARCHAR(30) DEFAULT 'incremental',
         time_of_day     TIME DEFAULT '09:00',
         timezone        VARCHAR(50) DEFAULT 'UTC',
         updated_at      TIMESTAMP DEFAULT NOW()
       )`
    );

    await orgPool.query('COMMIT');
    return { orgId, ok: true };
  } catch (err) {
    try {
      await orgPool.query('ROLLBACK');
    } catch {
      // ignore
    }
    return { orgId, ok: false, error: String(err?.message || err) };
  } finally {
    await orgPool.end();
  }
}

async function main() {
  const universalUrl = requireEnv('UNIVERSAL_DATABASE_URL');

  const universalPool = new Pool({
    connectionString: universalUrl,
    max: 2,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const hasConn = await hasColumn(universalPool, 'organizations', 'db_connection_string');
    if (!hasConn) {
      throw new Error("organizations.db_connection_string column not found; can't locate tenant DBs");
    }

    const orgs = await universalPool.query('SELECT id, db_connection_string FROM organizations');

    const results = [];
    for (const org of orgs.rows) {
      // eslint-disable-next-line no-await-in-loop
      const r = await migrateOrg(org.id, org.db_connection_string);
      results.push(r);
      const status = r.ok ? 'OK' : r.skipped ? 'SKIP' : 'FAIL';
      console.log(status, r.orgId, r.reason || r.error || '');
    }

    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;

    console.log(`Done. ok=${ok} failed=${failed} skipped=${skipped}`);
    if (failed) process.exitCode = 1;
  } finally {
    await universalPool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
