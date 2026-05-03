/*
  Updates tenant meeting constraints to Daily-compatible values.

  Usage:
    node db/migrations/migrate_meeting_provider_to_daily.js
*/

const { Pool } = require('pg');
const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config();

function normalizeConnectionString(value) {
  const v = String(value || '').trim();
  return v || null;
}

async function dropCheckConstraints(pool, tableName, matchText) {
  const constraintsResp = await pool.query(
    `SELECT conname, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     JOIN pg_class t ON c.conrelid = t.oid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = $1
       AND c.contype = 'c'`,
    [tableName]
  );

  for (const row of constraintsResp.rows || []) {
    const def = String(row.def || '').toLowerCase();
    if (!def.includes(matchText)) continue;

    await pool.query(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${row.conname}`);
  }
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

    await dropCheckConstraints(pool, 'meeting_sessions', 'video_provider');
    await dropCheckConstraints(pool, 'meeting_transcripts', 'source_type');

    await pool.query(
      `ALTER TABLE meeting_sessions
       ADD CONSTRAINT chk_meeting_sessions_video_provider_daily
       CHECK (video_provider IN ('none', 'daily', 'zoom', 'teams'))`
    );

    await pool.query(
      `ALTER TABLE meeting_transcripts
       ADD CONSTRAINT chk_meeting_transcripts_source_type_daily
       CHECK (source_type IN ('manual_upload', 'daily', 'zoom', 'teams', 'other'))`
    );

    await pool.query(
      `UPDATE meeting_sessions
       SET video_provider = 'daily'
       WHERE video_provider NOT IN ('none', 'daily', 'zoom', 'teams')`
    );
    await pool.query(
      `UPDATE meeting_transcripts
       SET source_type = 'daily'
       WHERE source_type NOT IN ('manual_upload', 'daily', 'zoom', 'teams', 'other')`
    );

    await pool.query('COMMIT');
    return { orgId, ok: true };
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    return { orgId, ok: false, error: String(err?.message || err) };
  } finally {
    await pool.end();
  }
}

async function main() {
  const universalUrl =
    normalizeConnectionString(process.env.UNIVERSAL_DATABASE_URL) ||
    normalizeConnectionString(process.env.DATABASE_URL);

  if (!universalUrl) {
    throw new Error('Missing UNIVERSAL_DATABASE_URL');
  }

  const universalPool = new Pool({
    connectionString: universalUrl,
    max: 2,
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const orgsResp = await universalPool.query('SELECT id, db_connection_string FROM organizations');
    const results = [];

    for (const org of orgsResp.rows) {
      const result = await migrateTenant(org.id, org.db_connection_string);
      results.push(result);
      const status = result.ok ? 'OK' : result.skipped ? 'SKIP' : 'FAIL';
      console.log(status, result.orgId, result.reason || result.error || '');
    }

    const ok = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok && !item.skipped).length;
    const skipped = results.filter((item) => item.skipped).length;

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
