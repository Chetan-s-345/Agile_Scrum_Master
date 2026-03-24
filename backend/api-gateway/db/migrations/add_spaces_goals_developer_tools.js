/*
  Adds spaces, goals, GitHub repo catalog, and developer-tools schema to tenant DBs.

  Usage:
    node db/migrations/add_spaces_goals_developer_tools.js
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

    await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS space_order INT DEFAULT 0`);
    await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_space_archived BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_default_space BOOLEAN DEFAULT FALSE`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS github_repos (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        github_repo_id BIGINT,
        owner_connection_id UUID REFERENCES github_integration(id) ON DELETE SET NULL,
        name VARCHAR(200) NOT NULL,
        full_name VARCHAR(260) NOT NULL,
        description TEXT,
        private BOOLEAN DEFAULT FALSE,
        language VARCHAR(80),
        stars INT DEFAULT 0,
        html_url TEXT,
        synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(full_name)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS goals (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title VARCHAR(300) NOT NULL,
        description TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed')),
        priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
        quarter VARCHAR(10),
        category VARCHAR(80),
        due_date DATE,
        progress INT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
        project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        created_by UUID REFERENCES team_members(id),
        key_results JSONB DEFAULT '[]'::jsonb,
        activity_log JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS goal_assignees (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(goal_id, user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS goal_repos (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        repo_id UUID NOT NULL REFERENCES github_repos(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(goal_id, repo_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS goal_sprints (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        sprint_id UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(goal_id, sprint_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS developer_api_keys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(140) NOT NULL,
        key_prefix VARCHAR(20) NOT NULL,
        key_last4 VARCHAR(8) NOT NULL,
        key_value TEXT NOT NULL,
        created_by UUID REFERENCES team_members(id) ON DELETE SET NULL,
        last_used_at TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS developer_webhooks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        endpoint_url TEXT NOT NULL,
        events TEXT[] DEFAULT '{}',
        is_active BOOLEAN DEFAULT TRUE,
        last_triggered_at TIMESTAMP,
        created_by UUID REFERENCES team_members(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_github_repos_owner ON github_repos(owner_connection_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_goal_assignees_goal ON goal_assignees(goal_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_goal_sprints_goal ON goal_sprints(goal_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_goal_repos_goal ON goal_repos(goal_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_projects_space_order ON projects(space_order, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_projects_space_archived ON projects(is_space_archived)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_projects_default_space ON projects(is_default_space)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dev_api_keys_active ON developer_api_keys(is_active, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_dev_webhooks_active ON developer_webhooks(is_active, created_at DESC)`);

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
