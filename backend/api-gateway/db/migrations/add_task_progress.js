/*
  Adds tasks.progress (0-100) to all tenant org databases.

  Usage:
    node db/migrations/add_task_progress.js

  Requirements:
    - UNIVERSAL_DATABASE_URL env var points at universal DB.
    - organizations table includes db_connection_string.
*/

const { Pool } = require('pg');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) throw new Error(`Missing env var: ${name}`);
  return String(value).trim();
}

function normalizeConnectionString(value) {
  const v = String(value || '').trim();
  return v || null;
}

async function hasColumn(pool, tableName, columnName) {
  const resp = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [String(tableName), String(columnName)]
  );
  return resp.rows.length > 0;
}

async function migrateTenant(orgId, connectionString) {
  const conn = normalizeConnectionString(connectionString);
  if (!conn) return { orgId, ok: false, skipped: true, reason: 'empty_connection_string' };

  const pool = new Pool({
    connectionString: conn,
    max: 1,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query('BEGIN');

    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress INT DEFAULT 0`);
    await pool.query(`UPDATE tasks SET progress = 0 WHERE progress IS NULL`);

    const hasCheck = await pool.query(
      `SELECT 1
       FROM pg_constraint c
       JOIN pg_class t ON c.conrelid = t.oid
       WHERE t.relname = 'tasks'
         AND c.conname = 'tasks_progress_range_check'
       LIMIT 1`
    );

    if (!hasCheck.rows.length) {
      await pool.query(
        `ALTER TABLE tasks
         ADD CONSTRAINT tasks_progress_range_check
         CHECK (progress >= 0 AND progress <= 100)`
      );
    }

    await pool.query('COMMIT');
    return { orgId, ok: true };
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    return { orgId, ok: false, error: String(err?.message || err) };
  } finally {
    await pool.end();
  }
}

async function main() {
  const universalUrl = requiredEnv('UNIVERSAL_DATABASE_URL');

  const universalPool = new Pool({
    connectionString: universalUrl,
    max: 2,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const hasDbConn = await hasColumn(universalPool, 'organizations', 'db_connection_string');
    if (!hasDbConn) {
      throw new Error("organizations.db_connection_string column not found; can't locate tenant DBs");
    }

    const orgs = await universalPool.query('SELECT id, db_connection_string FROM organizations');

    const results = [];
    for (const org of orgs.rows) {
      const out = await migrateTenant(org.id, org.db_connection_string);
      results.push(out);
      const status = out.ok ? 'OK' : out.skipped ? 'SKIP' : 'FAIL';
      console.log(status, out.orgId, out.reason || out.error || '');
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
