/*
  Adds meetings lifecycle schema to tenant DBs.

  Usage:
    node db/migrations/add_meetings_lifecycle.js
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
      CREATE TABLE IF NOT EXISTS meeting_sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sprint_id UUID REFERENCES sprints(id) ON DELETE SET NULL,
        project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        meeting_type VARCHAR(30) NOT NULL CHECK (meeting_type IN ('daily', 'weekly', 'retrospective', 'business')),
        video_provider VARCHAR(30) NOT NULL DEFAULT 'none' CHECK (video_provider IN ('none', 'livekit', 'zoom', 'teams')),
        provider_meeting_id TEXT,
        join_url TEXT,
        title VARCHAR(300) NOT NULL,
        description TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'archived')),
        scheduled_start TIMESTAMP NOT NULL,
        scheduled_end TIMESTAMP,
        actual_start TIMESTAMP,
        actual_end TIMESTAMP,
        ai_summary TEXT,
        ai_decisions TEXT,
        ai_risks TEXT,
        ai_action_items JSONB NOT NULL DEFAULT '[]',
        created_by UUID REFERENCES team_members(id),
        updated_by UUID REFERENCES team_members(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS video_provider VARCHAR(30) NOT NULL DEFAULT 'none'`);
    await pool.query(`ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS provider_meeting_id TEXT`);
    await pool.query(`ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS join_url TEXT`);
    await pool.query(`ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS actual_start TIMESTAMP`);
    await pool.query(`ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS actual_end TIMESTAMP`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_attendees (
        meeting_id UUID NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
        developer_id UUID NOT NULL REFERENCES developer_profiles(id) ON DELETE CASCADE,
        attendance_status VARCHAR(20) NOT NULL DEFAULT 'invited' CHECK (attendance_status IN ('invited', 'attended', 'absent', 'excused')),
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (meeting_id, developer_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
        author_member_id UUID REFERENCES team_members(id),
        content TEXT NOT NULL,
        is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_action_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
        title VARCHAR(300) NOT NULL,
        detail TEXT,
        assignee_developer_id UUID REFERENCES developer_profiles(id),
        due_date DATE,
        status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'blocked')),
        source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_transcripts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        meeting_id UUID NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
        source_type VARCHAR(30) NOT NULL DEFAULT 'manual_upload' CHECK (source_type IN ('manual_upload', 'livekit', 'zoom', 'teams', 'other')),
        file_name VARCHAR(260),
        mime_type VARCHAR(120),
        transcript_text TEXT NOT NULL,
        speaker_segments JSONB NOT NULL DEFAULT '[]',
        language VARCHAR(20),
        status VARCHAR(20) NOT NULL DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'failed')),
        error_message TEXT,
        uploaded_by UUID REFERENCES team_members(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_sessions_retrospective
      ON meeting_sessions(sprint_id, meeting_type)
      WHERE meeting_type = 'retrospective' AND sprint_id IS NOT NULL
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_sessions_type_status ON meeting_sessions(meeting_type, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_sessions_sprint ON meeting_sessions(sprint_id, scheduled_start DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_sessions_project ON meeting_sessions(project_id, scheduled_start DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_sessions_provider ON meeting_sessions(video_provider, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_attendees_dev ON meeting_attendees(developer_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting ON meeting_notes(meeting_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_action_items_meeting ON meeting_action_items(meeting_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_meeting ON meeting_transcripts(meeting_id, created_at DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_rooms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id TEXT NOT NULL,
        room_name TEXT NOT NULL,
        created_by TEXT NOT NULL,
        transcript TEXT DEFAULT '',
        summary TEXT DEFAULT '',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        UNIQUE (org_id, room_name)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_room_participants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES meeting_rooms(id) ON DELETE CASCADE,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        participant_name TEXT NOT NULL,
        identity TEXT,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        left_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        participation_notes TEXT DEFAULT '',
        UNIQUE (room_id, user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_room_individual_summaries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_id UUID NOT NULL REFERENCES meeting_rooms(id) ON DELETE CASCADE,
        org_id TEXT NOT NULL,
        participant_id UUID REFERENCES meeting_room_participants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        participant_name TEXT NOT NULL,
        summary TEXT DEFAULT '',
        action_items TEXT DEFAULT '',
        generated_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (room_id, user_id)
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_rooms_org ON meeting_rooms(org_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_rooms_status ON meeting_rooms(status, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_room_participants_room ON meeting_room_participants(room_id, status, joined_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_room_participants_org_user ON meeting_room_participants(org_id, user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_meeting_room_individual_summaries_room ON meeting_room_individual_summaries(room_id, generated_at DESC)`);

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
