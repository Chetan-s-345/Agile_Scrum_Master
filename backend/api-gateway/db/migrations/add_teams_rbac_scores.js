/*
  Adds teams collaboration + RBAC support tables to tenant DBs.

  Usage:
    node db/migrations/add_teams_rbac_scores.js
*/

const { Pool } = require('pg');
const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config();

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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        member_id UUID NOT NULL UNIQUE REFERENCES team_members(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL DEFAULT 'developer',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(200) NOT NULL,
        description TEXT,
        created_by UUID REFERENCES team_members(id) ON DELETE SET NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(name)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_memberships (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        role VARCHAR(30) NOT NULL DEFAULT 'developer' CHECK (role IN ('admin','developer')),
        joined_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(team_id, member_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS join_requests (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
        requested_at TIMESTAMP DEFAULT NOW(),
        reviewed_by UUID REFERENCES team_members(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        score DECIMAL(7,2) NOT NULL DEFAULT 0,
        metric VARCHAR(100) NOT NULL DEFAULT 'performance',
        updated_by UUID REFERENCES team_members(id) ON DELETE SET NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(team_id, member_id)
      )
    `);

    await pool.query(`
      INSERT INTO users (member_id, role)
      SELECT tm.id, tm.role
      FROM team_members tm
      ON CONFLICT (member_id) DO UPDATE
      SET role = EXCLUDED.role,
          updated_at = NOW()
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_member ON users(member_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_team_memberships_team ON team_memberships(team_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_team_memberships_member ON team_memberships(member_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_team_status ON join_requests(team_id, status, requested_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_member ON join_requests(member_id, requested_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_scores_team ON scores(team_id, score DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_scores_member ON scores(member_id)`);

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
  const universalUrl =
    normalizeConnectionString(process.env.UNIVERSAL_DATABASE_URL) ||
    normalizeConnectionString(process.env.DATABASE_URL) ||
    requiredEnv('UNIVERSAL_DATABASE_URL');

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
