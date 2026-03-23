/*
  Adds schema support for GitHub auto-task rules and linkage fields.

  Usage:
    node db/migrations/add_github_auto_task_support.js
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

    await pool.query(`ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS github_issue_number INT`);
    await pool.query(`ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS github_issue_url TEXT`);

    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS github_issue_number INT`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS github_issue_url TEXT`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS github_pr_number INT`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS github_pr_url TEXT`);

    await pool.query(
      `CREATE TABLE IF NOT EXISTS github_auto_task_rules (
         id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
         create_from_issues BOOLEAN DEFAULT TRUE,
         create_from_unlinked_prs BOOLEAN DEFAULT TRUE,
         sprint_ready_label VARCHAR(80) DEFAULT 'sprint-ready',
         label_mappings JSONB DEFAULT '{"bug":"bug","enhancement":"story","task":"task"}',
         created_at TIMESTAMP DEFAULT NOW(),
         updated_at TIMESTAMP DEFAULT NOW()
       )`
    );

    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_backlog_items_project_issue
       ON backlog_items(project_id, github_issue_number)
       WHERE github_issue_number IS NOT NULL`
    );

    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_project_issue
       ON tasks(project_id, github_issue_number)
       WHERE github_issue_number IS NOT NULL`
    );

    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_project_pr
       ON tasks(project_id, github_pr_number)
       WHERE github_pr_number IS NOT NULL`
    );

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
