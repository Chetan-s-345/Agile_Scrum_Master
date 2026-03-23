/*
  Adds per-action Jira sync log detail columns to jira_sync_log in all tenant org databases.

  Usage:
    node scripts/migrate-add-jira-sync-log-details.js

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

    const exists = await tableExists(orgPool, 'jira_sync_log');
    if (!exists) {
      await orgPool.query('ROLLBACK');
      return { orgId, ok: false, skipped: true, reason: 'jira_sync_log_missing' };
    }

    await orgPool.query(`ALTER TABLE jira_sync_log ADD COLUMN IF NOT EXISTS action VARCHAR(80)`);
    await orgPool.query(`ALTER TABLE jira_sync_log ADD COLUMN IF NOT EXISTS task_id UUID`);
    await orgPool.query(`ALTER TABLE jira_sync_log ADD COLUMN IF NOT EXISTS jira_issue_key VARCHAR(60)`);
    await orgPool.query(`ALTER TABLE jira_sync_log ADD COLUMN IF NOT EXISTS request_payload JSONB`);
    await orgPool.query(`ALTER TABLE jira_sync_log ADD COLUMN IF NOT EXISTS response_payload JSONB`);
    await orgPool.query(`ALTER TABLE jira_sync_log ADD COLUMN IF NOT EXISTS error_message TEXT`);

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
      // Serialize on purpose: reduces DB pressure and simplifies logs.
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
