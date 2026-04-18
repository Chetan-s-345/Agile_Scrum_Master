/*
  Creates github_pr_events and pr_review_weekly_summary in all tenant org databases.

  Usage:
    node db/migrations/create_github_pr_events.js

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

    await pool.query(
      `CREATE TABLE IF NOT EXISTS github_pr_events (
         id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
         pr_number INT NOT NULL,
         repo VARCHAR(200) NOT NULL,
         author VARCHAR(120),
         reviewer VARCHAR(120),
         opened_at TIMESTAMP,
         review_requested_at TIMESTAMP,
         first_review_at TIMESTAMP,
         approved_at TIMESTAMP,
         merged_at TIMESTAMP,
         sprint_id UUID REFERENCES sprints(id),
         task_id UUID REFERENCES tasks(id),
         created_at TIMESTAMP DEFAULT NOW(),
         updated_at TIMESTAMP DEFAULT NOW(),
         UNIQUE(repo, pr_number)
       )`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS pr_review_weekly_summary (
         id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
         week_start TIMESTAMP NOT NULL,
         week_end TIMESTAMP NOT NULL,
         group_by VARCHAR(30) NOT NULL,
         group_key VARCHAR(200) NOT NULL,
         avg_time_to_first_review_minutes DECIMAL(10,2),
         avg_time_to_approval_minutes DECIMAL(10,2),
         avg_time_to_merge_minutes DECIMAL(10,2),
         sample_size INT DEFAULT 0,
         created_at TIMESTAMP DEFAULT NOW(),
         updated_at TIMESTAMP DEFAULT NOW(),
         UNIQUE(week_start, week_end, group_by, group_key)
       )`
    );

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_github_pr_events_repo_pr ON github_pr_events(repo, pr_number)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_github_pr_events_reviewer ON github_pr_events(reviewer)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_github_pr_events_task ON github_pr_events(task_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pr_review_weekly_group ON pr_review_weekly_summary(group_by, group_key)`);

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
