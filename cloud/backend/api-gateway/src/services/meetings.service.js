const crypto = require('node:crypto');
const { AccessToken, TrackSource } = require('livekit-server-sdk');

const { env } = require('../config/env');
const { db } = require('../config/database');
const { sendMeetingInvite } = require('./email.service');
const { enqueuePostMeetingJob } = require('../jobs/post-meeting.job');
const { sendInngestEvent } = require('./inngestEvent.service');
const { emitToOrg } = require('../realtime/io');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDbTimestamp(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(
    date.getMinutes()
  )}:${pad2(date.getSeconds())}`;
}

function formatClientTimestamp(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatDbTimestamp(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const localMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (localMatch) {
    const [, y, m, d, hh, mm, ss] = localMatch;
    return `${y}-${m}-${d} ${hh}:${mm}:${ss || '00'}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return formatDbTimestamp(parsed);
}

function parseTimestamp(value, field) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw Object.assign(new Error(`Invalid ${field}`), { statusCode: 400, code: 'INVALID_TIMESTAMP' });
  }

  const localDateTimeMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (localDateTimeMatch) {
    const [, year, month, day, hour, minute, second] = localDateTimeMatch;
    return `${year}-${month}-${day} ${hour}:${minute}:${second || '00'}`;
  }

  const ts = new Date(raw);
  if (Number.isNaN(ts.getTime())) {
    throw Object.assign(new Error(`Invalid ${field}`), { statusCode: 400, code: 'INVALID_TIMESTAMP' });
  }

  return formatDbTimestamp(ts);
}

function parseTimecodeToSeconds(rawValue) {
  const raw = String(rawValue || '').trim().replace(',', '.');
  if (!raw) return null;

  const parts = raw.split(':').map((part) => part.trim());
  if (!parts.every(Boolean)) return null;

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
    return Number.isFinite(total) ? Math.max(0, total) : null;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    const total = Number(minutes) * 60 + Number(seconds);
    return Number.isFinite(total) ? Math.max(0, total) : null;
  }

  return null;
}

function extractSpeakerAndText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return { speaker: null, text: '' };

  const vttSpeaker = text.match(/^<v\s+([^>]+)>([\s\S]*)$/i);
  if (vttSpeaker) {
    return {
      speaker: vttSpeaker[1].trim() || null,
      text: vttSpeaker[2].replace(/<[^>]+>/g, '').trim(),
    };
  }

  const colonSpeaker = text.match(/^([^:\n]{1,60}):\s+([\s\S]+)$/);
  if (colonSpeaker) {
    return {
      speaker: colonSpeaker[1].trim(),
      text: colonSpeaker[2].trim(),
    };
  }

  return { speaker: null, text };
}

function parseSrtSegments(transcriptText) {
  const blocks = String(transcriptText || '')
    .split(/\r?\n\r?\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  const segments = [];

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) continue;

    const timelineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timelineIndex < 0) continue;

    const timeline = lines[timelineIndex];
    const [rawStart, rawEnd] = timeline.split('-->').map((item) => item.trim());
    const start = parseTimecodeToSeconds(rawStart);
    const end = parseTimecodeToSeconds(rawEnd);
    const content = lines.slice(timelineIndex + 1).join(' ').trim();
    if (!content) continue;

    const parsed = extractSpeakerAndText(content);
    segments.push({
      speaker: parsed.speaker,
      start,
      end,
      text: parsed.text,
    });
  }

  return segments;
}

function parseVttSegments(transcriptText) {
  const lines = String(transcriptText || '').split(/\r?\n/);
  const segments = [];

  let idx = 0;
  while (idx < lines.length) {
    const line = String(lines[idx] || '').trim();
    if (!line || /^WEBVTT/i.test(line) || /^NOTE\b/i.test(line) || /^STYLE\b/i.test(line) || /^REGION\b/i.test(line)) {
      idx += 1;
      continue;
    }

    let timeline = line;
    if (!timeline.includes('-->') && idx + 1 < lines.length) {
      const next = String(lines[idx + 1] || '').trim();
      if (next.includes('-->')) {
        timeline = next;
        idx += 1;
      }
    }

    if (!timeline.includes('-->')) {
      idx += 1;
      continue;
    }

    const [rawStart, rawEndWithMeta] = timeline.split('-->').map((item) => item.trim());
    const rawEnd = String(rawEndWithMeta || '').split(/\s+/)[0] || '';
    const start = parseTimecodeToSeconds(rawStart);
    const end = parseTimecodeToSeconds(rawEnd);

    idx += 1;
    const textLines = [];
    while (idx < lines.length) {
      const cueLine = String(lines[idx] || '');
      if (!cueLine.trim()) break;
      textLines.push(cueLine.trim());
      idx += 1;
    }

    const content = textLines.join(' ').trim();
    if (content) {
      const parsed = extractSpeakerAndText(content);
      segments.push({
        speaker: parsed.speaker,
        start,
        end,
        text: parsed.text,
      });
    }

    idx += 1;
  }

  return segments;
}

function inferTranscriptFormat({ fileName, mimeType, transcriptText }) {
  const name = String(fileName || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  const source = String(transcriptText || '');

  if (name.endsWith('.vtt') || mime.includes('text/vtt') || /^\s*WEBVTT\b/i.test(source)) return 'vtt';
  if (name.endsWith('.srt') || mime.includes('application/x-subrip') || /-->/.test(source)) return 'srt';
  return 'plain';
}

function normalizeTranscriptInput({ transcriptText, fileName, mimeType, speakerSegments }) {
  if (Array.isArray(speakerSegments) && speakerSegments.length) {
    return {
      transcriptText: String(transcriptText || '').trim(),
      speakerSegments,
    };
  }

  const format = inferTranscriptFormat({ fileName, mimeType, transcriptText });
  if (format === 'plain') {
    return {
      transcriptText: String(transcriptText || '').trim(),
      speakerSegments: [],
    };
  }

  const parsedSegments = format === 'vtt' ? parseVttSegments(transcriptText) : parseSrtSegments(transcriptText);
  const normalizedText =
    parsedSegments.map((item) => item.text).filter(Boolean).join('\n').trim() || String(transcriptText || '').trim();

  return {
    transcriptText: normalizedText,
    speakerSegments: parsedSegments,
  };
}

function isValidLiveKitUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return (url.protocol === 'wss:' || url.protocol === 'ws:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function normalizeProvider(value) {
  const normalized = String(value || 'livekit').trim().toLowerCase();
  if (normalized === 'livekit') return 'livekit';
  if (normalized === 'daily') return 'livekit';
  if (normalized === 'zoom') return 'zoom';
  if (normalized === 'teams') return 'teams';
  return 'livekit';
}

function normalizeMeetingKind(value) {
  const normalized = String(value || 'normal').trim().toLowerCase();
  if (normalized === 'sprint_planner') return 'sprint_planner';
  return 'normal';
}

function normalizeNormalCategory(value) {
  const normalized = String(value || 'daily_sprint').trim().toLowerCase();
  if (normalized === 'weekly_sprint') return 'weekly_sprint';
  if (normalized === 'backlogs') return 'backlogs';
  if (normalized === 'business_meeting') return 'business_meeting';
  if (normalized === 'retrospective') return 'retrospective';
  return 'daily_sprint';
}

async function ensureMeetingRoomsTable(orgPool) {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS meeting_rooms (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       org_id TEXT NOT NULL,
       room_name TEXT NOT NULL,
       created_by TEXT NOT NULL,
       meeting_kind TEXT NOT NULL DEFAULT 'normal',
       normal_category TEXT NOT NULL DEFAULT 'daily_sprint',
       title TEXT,
      description TEXT,
       scheduled_for TIMESTAMPTZ,
       transcript TEXT DEFAULT '',
       summary TEXT DEFAULT '',
       status TEXT DEFAULT 'active',
       created_at TIMESTAMPTZ DEFAULT NOW(),
       ended_at TIMESTAMPTZ,
       UNIQUE(org_id, room_name)
     )`
  );

  await orgPool.query(`ALTER TABLE meeting_rooms ADD COLUMN IF NOT EXISTS meeting_kind TEXT NOT NULL DEFAULT 'normal'`);
  await orgPool.query(`ALTER TABLE meeting_rooms ADD COLUMN IF NOT EXISTS normal_category TEXT NOT NULL DEFAULT 'daily_sprint'`);
  await orgPool.query(`ALTER TABLE meeting_rooms ADD COLUMN IF NOT EXISTS title TEXT`);
  await orgPool.query(`ALTER TABLE meeting_rooms ADD COLUMN IF NOT EXISTS description TEXT`);
  await orgPool.query(`ALTER TABLE meeting_rooms ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ`);

  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS meeting_room_participants (
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
       UNIQUE(room_id, user_id)
     )`
  );

  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS meeting_room_individual_summaries (
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
       UNIQUE(room_id, user_id)
     )`
  );

    await orgPool.query(
     `CREATE TABLE IF NOT EXISTS meeting_room_messages (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       room_id UUID NOT NULL REFERENCES meeting_rooms(id) ON DELETE CASCADE,
       org_id TEXT NOT NULL,
       user_id TEXT NOT NULL,
       participant_name TEXT NOT NULL,
       message TEXT NOT NULL,
       created_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );

  await orgPool.query(
    'CREATE INDEX IF NOT EXISTS idx_meeting_room_participants_room ON meeting_room_participants(room_id, status, joined_at DESC)'
  );
  await orgPool.query(
    'CREATE INDEX IF NOT EXISTS idx_meeting_room_participants_org_user ON meeting_room_participants(org_id, user_id)'
  );
  await orgPool.query(
    'CREATE INDEX IF NOT EXISTS idx_meeting_room_individual_summaries_room ON meeting_room_individual_summaries(room_id, generated_at DESC)'
  );
  await orgPool.query('CREATE INDEX IF NOT EXISTS idx_meeting_room_messages_room ON meeting_room_messages(room_id, created_at ASC)');
}

function buildScrumSummaryPrompt(transcript) {
  return [
    'You are an AI Scrum Master. Summarise this meeting transcript for an agile team.',
    'Structure your response as:',
    '## Summary',
    '## Key Decisions',
    '## Action Items (with owner if mentioned)',
    '## Blockers',
    `Transcript: ${String(transcript || '').trim()}`,
  ].join('\n');
}

function buildIndividualSummaryPrompt(transcript, participantName, focus) {
  const normalizedName = String(participantName || 'Team member').trim() || 'Team member';
  const normalizedFocus = String(focus || '').trim();

  return [
    'You are an AI Scrum Master.',
    `Create an individual summary for ${normalizedName} from this meeting transcript.`,
    'The summary must be practical and personalized for this person.',
    normalizedFocus ? `Focus: ${normalizedFocus}` : null,
    'Structure your response as:',
    '## Individual Summary',
    '## Responsibilities and Commitments',
    '## Action Items for This Person',
    '## Risks and Follow-ups',
    `Transcript: ${String(transcript || '').trim()}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function getGroqModels() {
  const configured = String(process.env.GROQ_MODEL || '').trim();
  const candidates = [configured, 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768'].filter(Boolean);
  return Array.from(new Set(candidates));
}

async function callGroqSummary({ prompt, maxTokens }) {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) {
    throw Object.assign(new Error('GROQ_API_KEY is not configured'), {
      statusCode: 500,
      code: 'GROQ_CONFIG_MISSING',
      detail: 'Set GROQ_API_KEY to generate meeting summaries.',
    });
  }

  const models = getGroqModels();
  let lastDetail = 'Groq request failed';

  for (const model of models) {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: 'You are an AI Scrum Master assistant. Respond in Markdown with clear sections.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const payload = await resp.json().catch(() => null);
    if (resp.ok) {
      const content = String(payload?.choices?.[0]?.message?.content || '').trim();
      if (content) return content;
      lastDetail = 'Groq returned an empty summary.';
      continue;
    }

    const detail = String(payload?.error?.message || payload?.message || `Groq request failed with ${resp.status}`);
    lastDetail = detail;

    const shouldTryNextModel = /model|not found|invalid|unsupported/i.test(detail);
    if (!shouldTryNextModel) {
      throw Object.assign(new Error(detail), { statusCode: resp.status || 502, code: 'GROQ_SUMMARY_FAILED', detail });
    }
  }

  throw Object.assign(new Error(lastDetail), {
    statusCode: 502,
    code: 'GROQ_SUMMARY_FAILED',
    detail: lastDetail,
  });
}

async function summarizeMeetingRoomTranscript(transcript) {
  return callGroqSummary({
    prompt: buildScrumSummaryPrompt(transcript),
    maxTokens: 900,
  });
}

async function summarizeParticipantMeetingRoomTranscript(transcript, participantName, focus) {
  return callGroqSummary({
    prompt: buildIndividualSummaryPrompt(transcript, participantName, focus),
    maxTokens: 700,
  });
}

function individualSummaryFallback(participantName) {
  const normalizedName = String(participantName || 'Team member').trim() || 'Team member';
  return [
    '## Individual Summary',
    `Unable to generate a personalized summary for ${normalizedName} right now.`,
    '',
    '## Responsibilities and Commitments',
    '- Not available.',
    '',
    '## Action Items for This Person',
    '- Not available.',
    '',
    '## Risks and Follow-ups',
    '- Not available.',
  ].join('\n');
}

function mapMeetingRoomRow(row) {
  return {
    id: row.id,
    orgId: row.org_id,
    roomName: row.room_name,
    createdBy: row.created_by,
    meetingKind: row.meeting_kind || 'normal',
    normalCategory: row.normal_category || 'daily_sprint',
    title: row.title || null,
    description: row.description || null,
    scheduledFor: row.scheduled_for || null,
    transcript: row.transcript || '',
    summary: row.summary || '',
    mySummary: row.my_summary || '',
    mySummaryGeneratedAt: row.my_summary_generated_at || null,
    status: row.status,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };
}

function mapParticipantRow(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    orgId: row.org_id,
    userId: row.user_id,
    participantName: row.participant_name,
    identity: row.identity || null,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    lastSeenAt: row.last_seen_at,
    participationNotes: row.participation_notes || '',
  };
}

function mapMeetingRoomMessageRow(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    orgId: row.org_id,
    userId: row.user_id,
    participantName: row.participant_name,
    message: row.message,
    createdAt: row.created_at,
  };
}

function getMeetingDurationMinutes(scheduledStart, scheduledEnd) {
  const start = new Date(String(scheduledStart || ''));
  const end = new Date(String(scheduledEnd || ''));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 60;

  const deltaMs = end.getTime() - start.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 60;

  const mins = Math.round(deltaMs / 60000);
  return Math.max(15, Math.min(mins, 8 * 60));
}

function requireOrgDb(req) {
  const pool = req.orgDb;
  if (!pool) throw Object.assign(new Error('Org DB not attached'), { statusCode: 500, code: 'ORG_DB_MISSING' });
  return pool;
}

function requireMeetingAdmin(req) {
  const role = String(req.user?.role || '').trim().toLowerCase();
  if (role === 'owner' || role === 'admin') return;

  throw Object.assign(new Error('Only organization admins can create or end meetings'), {
    statusCode: 403,
    code: 'MEETING_ADMIN_REQUIRED',
    detail: 'This action requires owner or admin role.',
  });
}

async function getActorMemberId(orgPool, userId) {
  const resp = await orgPool.query('SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1', [String(userId)]);
  return resp.rows[0]?.id || null;
}

async function getSystemActorMemberId(orgPool) {
  const resp = await orgPool.query('SELECT id FROM team_members ORDER BY created_at ASC LIMIT 1');
  return resp.rows[0]?.id || null;
}

async function getMeetingAttendeeContacts(orgPool, meetingId) {
  const resp = await orgPool.query(
    `SELECT tm.email, tm.full_name
     FROM meeting_attendees ma
     JOIN developer_profiles dp ON dp.id = ma.developer_id
     JOIN team_members tm ON tm.id = dp.member_id
     WHERE ma.meeting_id = $1
     ORDER BY tm.full_name ASC`,
    [String(meetingId)]
  );

  return resp.rows
    .map((row) => ({
      email: String(row.email || '').trim().toLowerCase(),
      name: String(row.full_name || 'Team member').trim() || 'Team member',
    }))
    .filter((row) => row.email.includes('@'));
}

function buildGeneratedDescription(sourceText) {
  const source = String(sourceText || '').trim();
  if (!source) {
    return {
      description: 'No description generated because source text is empty.',
      aiSummary: null,
      aiDecisions: null,
      aiRisks: null,
      aiActionItems: [],
    };
  }

  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const summary = lines.slice(0, 4).join(' ');
  const decisionLines = lines.filter((line) => /decision|decided|approve|approved/i.test(line)).slice(0, 6);
  const riskLines = lines.filter((line) => /risk|blocker|blocked|issue|concern/i.test(line)).slice(0, 6);
  const itemLines = lines.filter((line) => /action|todo|next|follow[- ]?up|owner/i.test(line)).slice(0, 8);

  const actionItems = itemLines.map((line, index) => ({
    id: `ai-${index + 1}`,
    title: line.slice(0, 280),
    status: 'open',
  }));

  return {
    description: summary || source.slice(0, 1200),
    aiSummary: summary || null,
    aiDecisions: decisionLines.join('\n') || null,
    aiRisks: riskLines.join('\n') || null,
    aiActionItems: actionItems,
  };
}

async function summarizeViaGroq({ meetingTitle, meetingType, sourceText, notes }) {
  const base = String(env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
  const response = await fetch(`${base}/groq/meeting-summarizer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meeting_title: meetingTitle || null,
      meeting_type: meetingType || null,
      transcript: String(sourceText || ''),
      notes: Array.isArray(notes) ? notes : [],
    }),
  });
  if (!response.ok) throw new Error(`Groq summarize failed (${response.status})`);

  const payload = await response.json().catch(() => null);
  const actionItems = Array.isArray(payload?.action_items)
    ? payload.action_items
        .map((item) => ({
          id: String(item?.id || item?.title || crypto.randomUUID().slice(0, 8)),
          title: String(item?.title || '').trim(),
          status: String(item?.status || 'open'),
          source: String(item?.source || 'ai'),
        }))
        .filter((item) => item.title)
    : [];

  return {
    description: String(payload?.summary || '').trim(),
    aiSummary: String(payload?.summary || '').trim(),
    aiDecisions: String(payload?.decisions || '').trim(),
    aiRisks: String(payload?.risks || '').trim(),
    aiActionItems: actionItems,
  };
}

class MeetingsService {
  async createDailyRoom(meetingId, durationMinutes = 60) {
    const livekitUrl = String(process.env.LIVEKIT_URL || '').trim();
    if (!isValidLiveKitUrl(livekitUrl)) {
      throw Object.assign(new Error('LIVEKIT_URL is not configured'), {
        statusCode: 500,
        code: 'LIVEKIT_CONFIG_MISSING',
        detail: 'Set LIVEKIT_URL in the api-gateway environment.',
      });
    }

    void durationMinutes;
    return { joinUrl: livekitUrl, providerMeetingId: `lk-${String(meetingId || '').trim()}` };
  }

  async list(req, filters) {
    const orgPool = requireOrgDb(req);
    const where = [];
    const params = [];

    const push = (expr, val) => {
      params.push(val);
      where.push(expr.replace('?', `$${params.length}`));
    };

    if (filters.type) push('m.meeting_type = ?', String(filters.type));
    if (filters.status) push('m.status = ?', String(filters.status));
    if (filters.sprintId) push('m.sprint_id = ?', String(filters.sprintId));
    if (filters.projectId) push('m.project_id = ?', String(filters.projectId));

    const limit = Number(filters.limit || 100);
    params.push(limit);

    const resp = await orgPool.query(
      `SELECT
         m.id,
         m.sprint_id,
         m.project_id,
         m.meeting_type,
         m.video_provider,
         m.provider_meeting_id,
         m.join_url,
         m.title,
         m.description,
         m.status,
         m.scheduled_start,
         m.scheduled_end,
         m.actual_start,
         m.actual_end,
         m.ai_summary,
         m.ai_decisions,
         m.ai_risks,
         m.ai_action_items,
         m.created_by,
         m.created_at,
         m.updated_at,
         s.name AS sprint_name,
         p.name AS project_name,
         (SELECT COUNT(*)::int FROM meeting_attendees ma WHERE ma.meeting_id = m.id) AS attendee_count,
         (SELECT COUNT(*)::int FROM meeting_notes mn WHERE mn.meeting_id = m.id) AS note_count
       FROM meeting_sessions m
       LEFT JOIN sprints s ON s.id = m.sprint_id
       LEFT JOIN projects p ON p.id = m.project_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY m.scheduled_start DESC, m.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    return resp.rows.map((row) => ({
      id: row.id,
      sprintId: row.sprint_id,
      sprintName: row.sprint_name,
      projectId: row.project_id,
      projectName: row.project_name,
      type: row.meeting_type,
      videoProvider: row.video_provider,
      providerMeetingId: row.provider_meeting_id,
      joinUrl: row.join_url,
      title: row.title,
      description: row.description,
      status: row.status,
      scheduledStart: formatClientTimestamp(row.scheduled_start),
      scheduledEnd: formatClientTimestamp(row.scheduled_end),
      actualStart: formatClientTimestamp(row.actual_start),
      actualEnd: formatClientTimestamp(row.actual_end),
      aiSummary: row.ai_summary,
      aiDecisions: row.ai_decisions,
      aiRisks: row.ai_risks,
      aiActionItems: Array.isArray(row.ai_action_items) ? row.ai_action_items : [],
      attendeeCount: Number(row.attendee_count || 0),
      noteCount: Number(row.note_count || 0),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getById(req, meetingId) {
    const orgPool = requireOrgDb(req);
    return this.getByIdFromPool(orgPool, meetingId);
  }

  async getByIdFromPool(orgPool, meetingId) {
    const meetingResp = await orgPool.query(
      `SELECT
         m.id,
         m.sprint_id,
         m.project_id,
         m.meeting_type,
         m.video_provider,
         m.provider_meeting_id,
         m.join_url,
         m.title,
         m.description,
         m.status,
         m.scheduled_start,
         m.scheduled_end,
         m.actual_start,
         m.actual_end,
         m.ai_summary,
         m.ai_decisions,
         m.ai_risks,
         m.ai_action_items,
         m.created_by,
         m.created_at,
         m.updated_at,
         s.name AS sprint_name,
         p.name AS project_name
       FROM meeting_sessions m
       LEFT JOIN sprints s ON s.id = m.sprint_id
       LEFT JOIN projects p ON p.id = m.project_id
       WHERE m.id = $1
       LIMIT 1`,
      [String(meetingId)]
    );

    const row = meetingResp.rows[0] || null;
    if (!row) return null;

    const [attendeesResp, notesResp, actionsResp] = await Promise.all([
      orgPool.query(
        `SELECT
           ma.developer_id,
           ma.attendance_status,
           ma.note,
           tm.full_name
         FROM meeting_attendees ma
         JOIN developer_profiles dp ON dp.id = ma.developer_id
         LEFT JOIN team_members tm ON tm.id = dp.member_id
         WHERE ma.meeting_id = $1
         ORDER BY COALESCE(tm.full_name, 'Developer') ASC`,
        [String(meetingId)]
      ),
      orgPool.query(
        `SELECT
           mn.id,
           mn.content,
           mn.is_ai_generated,
           mn.created_at,
           mn.updated_at,
           mn.author_member_id,
           tm.full_name AS author_name
         FROM meeting_notes mn
         LEFT JOIN team_members tm ON tm.id = mn.author_member_id
         WHERE mn.meeting_id = $1
         ORDER BY mn.created_at DESC`,
        [String(meetingId)]
      ),
      orgPool.query(
        `SELECT
           mai.id,
           mai.title,
           mai.detail,
           mai.status,
           mai.due_date,
           mai.source,
           mai.assignee_developer_id,
           tm.full_name AS assignee_name,
           mai.created_at,
           mai.updated_at
         FROM meeting_action_items mai
         LEFT JOIN developer_profiles dp ON dp.id = mai.assignee_developer_id
         LEFT JOIN team_members tm ON tm.id = dp.member_id
         WHERE mai.meeting_id = $1
         ORDER BY mai.created_at DESC`,
        [String(meetingId)]
      ),
    ]);

    return {
      id: row.id,
      sprintId: row.sprint_id,
      sprintName: row.sprint_name,
      projectId: row.project_id,
      projectName: row.project_name,
      type: row.meeting_type,
      videoProvider: row.video_provider,
      providerMeetingId: row.provider_meeting_id,
      joinUrl: row.join_url,
      title: row.title,
      description: row.description,
      status: row.status,
      scheduledStart: formatClientTimestamp(row.scheduled_start),
      scheduledEnd: formatClientTimestamp(row.scheduled_end),
      actualStart: formatClientTimestamp(row.actual_start),
      actualEnd: formatClientTimestamp(row.actual_end),
      aiSummary: row.ai_summary,
      aiDecisions: row.ai_decisions,
      aiRisks: row.ai_risks,
      aiActionItems: Array.isArray(row.ai_action_items) ? row.ai_action_items : [],
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      attendees: attendeesResp.rows.map((item) => ({
        developerId: item.developer_id,
        name: item.full_name || 'Developer',
        attendanceStatus: item.attendance_status,
        note: item.note,
      })),
      notes: notesResp.rows.map((item) => ({
        id: item.id,
        content: item.content,
        isAiGenerated: Boolean(item.is_ai_generated),
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        authorMemberId: item.author_member_id,
        authorName: item.author_name,
      })),
      actionItems: actionsResp.rows.map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.detail,
        status: item.status,
        dueDate: item.due_date,
        source: item.source,
        assigneeDeveloperId: item.assignee_developer_id,
        assigneeName: item.assignee_name || null,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
    };
  }

  async create(req, payload) {
    requireMeetingAdmin(req);
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) {
      throw Object.assign(new Error('Team member not found'), { statusCode: 403, code: 'TEAM_MEMBER_NOT_FOUND' });
    }

    return this.createWithPool({
      orgPool,
      actorMemberId: String(actorMemberId),
      orgId: String(req.user?.orgId || ''),
      payload,
    });
  }

  async createForOrg(orgId, payload) {
    const orgPool = await db.getOrgPool(String(orgId));
    const actorMemberId = await getSystemActorMemberId(orgPool);
    if (!actorMemberId) {
      throw Object.assign(new Error('Cannot schedule meetings without an org team member'), {
        statusCode: 409,
        code: 'TEAM_MEMBER_NOT_FOUND',
      });
    }

    return this.createWithPool({
      orgPool,
      actorMemberId: String(actorMemberId),
      orgId: String(orgId),
      payload,
    });
  }

  async createWithPool({ orgPool, actorMemberId, orgId, payload }) {
    const scheduledStart = parseTimestamp(payload.scheduledStart, 'scheduledStart');
    const scheduledEnd = payload.scheduledEnd ? parseTimestamp(payload.scheduledEnd, 'scheduledEnd') : null;
    const meetingId = crypto.randomUUID();
    const attendees = Array.isArray(payload.attendeeDeveloperIds) ? payload.attendeeDeveloperIds : [];

    const provider = normalizeProvider(payload?.provider || 'livekit');
    const shouldCreateJoinUrl = payload?.createJoinUrl !== false;

    let joinUrl = payload?.joinUrl ? String(payload.joinUrl).trim() : null;
    let providerMeetingId = payload?.providerMeetingId ? String(payload.providerMeetingId).trim() : null;

    if (shouldCreateJoinUrl && provider === 'livekit' && !joinUrl) {
      const durationMinutes = getMeetingDurationMinutes(scheduledStart, scheduledEnd);
      const created = await this.createDailyRoom(meetingId, durationMinutes);
      joinUrl = String(created.joinUrl || '').trim() || null;
      providerMeetingId = String(created.providerMeetingId || '').trim() || null;
    }

    if (provider === 'livekit' && joinUrl && !isValidLiveKitUrl(joinUrl)) {
      throw Object.assign(new Error('joinUrl must be a valid LiveKit URL'), {
        statusCode: 400,
        code: 'LIVEKIT_INVALID_JOIN_URL',
        detail: 'Expected a ws://, wss://, or https:// URL when provider is livekit.',
      });
    }

    await orgPool.query(
      `INSERT INTO meeting_sessions (
         id,
         sprint_id,
         project_id,
         meeting_type,
         video_provider,
         provider_meeting_id,
         join_url,
         title,
         description,
         status,
         scheduled_start,
         scheduled_end,
         created_by,
         updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scheduled',$10,$11,$12,$12)`,
      [
        meetingId,
        payload.sprintId || null,
        payload.projectId || null,
        String(payload.type),
        provider,
        providerMeetingId,
        joinUrl,
        String(payload.title),
        payload.description || null,
        scheduledStart,
        scheduledEnd,
        String(actorMemberId),
      ]
    );

    for (const developerId of attendees) {
      await orgPool.query(
        `INSERT INTO meeting_attendees (meeting_id, developer_id, attendance_status)
         VALUES ($1,$2,'invited')
         ON CONFLICT (meeting_id, developer_id) DO NOTHING`,
        [meetingId, String(developerId)]
      );
    }

    const item = await this.getByIdFromPool(orgPool, meetingId);

    if (item?.joinUrl) {
      try {
        const contacts = await getMeetingAttendeeContacts(orgPool, meetingId);
        if (contacts.length) {
          await sendMeetingInvite(
            {
              id: meetingId,
              type: item.type,
              title: item.title,
              scheduledStart: item.scheduledStart,
              joinUrl: item.joinUrl,
              orgId,
            },
            contacts
          );
        }
      } catch {
        // Invite delivery is best-effort; meeting creation should not fail.
      }
    }

    return item;
  }

  async update(req, meetingId, patch) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403, code: 'TEAM_MEMBER_NOT_FOUND' });

    const currentResp = await orgPool.query('SELECT status FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!currentResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404, code: 'MEETING_NOT_FOUND' });
    const previousStatus = String(currentResp.rows[0].status || '');

    const sets = [];
    const params = [];

    const addSet = (field, value) => {
      params.push(value);
      sets.push(`${field} = $${params.length}`);
    };

    if (patch.title !== undefined) addSet('title', String(patch.title));
    if (patch.status !== undefined) {
      if (String(patch.status) === 'completed' || String(patch.status) === 'archived') {
        requireMeetingAdmin(req);
      }
      addSet('status', String(patch.status));
      if (String(patch.status) === 'in_progress') {
        sets.push('actual_start = COALESCE(actual_start, NOW())');
      }
      if (String(patch.status) === 'completed') {
        sets.push('actual_end = COALESCE(actual_end, NOW())');
      }
    }
    if (patch.description !== undefined) addSet('description', patch.description || null);
    if (patch.scheduledStart !== undefined) addSet('scheduled_start', parseTimestamp(patch.scheduledStart, 'scheduledStart'));
    if (patch.scheduledEnd !== undefined) {
      addSet('scheduled_end', patch.scheduledEnd ? parseTimestamp(patch.scheduledEnd, 'scheduledEnd') : null);
    }

    addSet('updated_by', String(actorMemberId));

    params.push(String(meetingId));
    const whereId = `$${params.length}`;

    await orgPool.query(
      `UPDATE meeting_sessions
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = ${whereId}`,
      params
    );

    const item = await this.getById(req, meetingId);

    const nextStatus = String(patch?.status || '');
    const transitionedToCompleted = previousStatus !== 'completed' && nextStatus === 'completed';
    if (transitionedToCompleted && req.user?.orgId) {
      try {
        await sendInngestEvent('meeting/completed', {
          orgId: String(req.user.orgId || ''),
          meetingId: String(meetingId),
          sprintId: item?.sprintId || null,
          projectId: item?.projectId || null,
          meetingType: item?.type || null,
          title: item?.title || null,
          source: 'meeting-status-update',
        });
      } catch {
        // Inngest dispatch is best-effort and must not block completion workflow.
      }

      try {
        await enqueuePostMeetingJob({
          orgId: String(req.user.orgId),
          meetingId: String(meetingId),
          source: 'meeting-status-update',
        });
      } catch {
        // Best-effort queueing; request should still succeed.
      }
    }

    return item;
  }

  async delete(req, meetingId) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403, code: 'TEAM_MEMBER_NOT_FOUND' });

    const deleteResp = await orgPool.query(
      `DELETE FROM meeting_sessions
       WHERE id = $1
       RETURNING id`,
      [String(meetingId)]
    );

    if (!deleteResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404, code: 'MEETING_NOT_FOUND' });

    return {
      id: String(deleteResp.rows[0].id),
      deleted: true,
    };
  }

  async setAttendees(req, meetingId, attendeeDeveloperIds) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403, code: 'TEAM_MEMBER_NOT_FOUND' });

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404, code: 'MEETING_NOT_FOUND' });

    await orgPool.query('BEGIN');
    try {
      await orgPool.query('DELETE FROM meeting_attendees WHERE meeting_id = $1', [String(meetingId)]);

      for (const developerId of attendeeDeveloperIds) {
        await orgPool.query(
          `INSERT INTO meeting_attendees (meeting_id, developer_id, attendance_status)
           VALUES ($1,$2,'invited')
           ON CONFLICT (meeting_id, developer_id) DO NOTHING`,
          [String(meetingId), String(developerId)]
        );
      }

      await orgPool.query('UPDATE meeting_sessions SET updated_by = $2, updated_at = NOW() WHERE id = $1', [
        String(meetingId),
        String(actorMemberId),
      ]);

      await orgPool.query('COMMIT');
    } catch (err) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw err;
    }

    return this.getById(req, meetingId);
  }

  async listNotes(req, meetingId) {
    const orgPool = requireOrgDb(req);
    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404, code: 'MEETING_NOT_FOUND' });

    const resp = await orgPool.query(
      `SELECT
         mn.id,
         mn.content,
         mn.is_ai_generated,
         mn.created_at,
         mn.updated_at,
         mn.author_member_id,
         tm.full_name AS author_name
       FROM meeting_notes mn
       LEFT JOIN team_members tm ON tm.id = mn.author_member_id
       WHERE mn.meeting_id = $1
       ORDER BY mn.created_at DESC`,
      [String(meetingId)]
    );

    return resp.rows.map((item) => ({
      id: item.id,
      content: item.content,
      isAiGenerated: Boolean(item.is_ai_generated),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      authorMemberId: item.author_member_id,
      authorName: item.author_name,
    }));
  }

  async addNote(req, meetingId, payload) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403, code: 'TEAM_MEMBER_NOT_FOUND' });

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404, code: 'MEETING_NOT_FOUND' });

    const insertResp = await orgPool.query(
      `INSERT INTO meeting_notes (meeting_id, author_member_id, content, is_ai_generated)
       VALUES ($1,$2,$3,$4)
       RETURNING id, content, is_ai_generated, created_at, updated_at, author_member_id`,
      [String(meetingId), String(actorMemberId), String(payload.content), Boolean(payload.isAiGenerated)]
    );

    await orgPool.query('UPDATE meeting_sessions SET updated_by = $2, updated_at = NOW() WHERE id = $1', [
      String(meetingId),
      String(actorMemberId),
    ]);

    const row = insertResp.rows[0];
    return {
      id: row.id,
      content: row.content,
      isAiGenerated: Boolean(row.is_ai_generated),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      authorMemberId: row.author_member_id,
    };
  }

  async updateDescription(req, meetingId, payload) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403, code: 'TEAM_MEMBER_NOT_FOUND' });

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404, code: 'MEETING_NOT_FOUND' });

    const generated = payload.autoGenerate ? buildGeneratedDescription(payload.sourceText) : null;
    const nextDescription =
      payload.description !== undefined ? payload.description : generated ? generated.description : undefined;

    const sets = [];
    const params = [];
    const addSet = (field, value) => {
      params.push(value);
      sets.push(`${field} = $${params.length}`);
    };

    if (nextDescription !== undefined) addSet('description', nextDescription || null);
    if (generated) {
      addSet('ai_summary', generated.aiSummary);
      addSet('ai_decisions', generated.aiDecisions);
      addSet('ai_risks', generated.aiRisks);
      addSet('ai_action_items', generated.aiActionItems);
    }

    addSet('updated_by', String(actorMemberId));

    params.push(String(meetingId));
    const whereId = `$${params.length}`;

    await orgPool.query(
      `UPDATE meeting_sessions
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = ${whereId}`,
      params
    );

    return this.getById(req, meetingId);
  }

  async startMeeting(req, meetingId, payload) {
    requireMeetingAdmin(req);
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403, code: 'TEAM_MEMBER_NOT_FOUND' });

    const existsResp = await orgPool.query(
      `SELECT id, title, description, scheduled_start, scheduled_end, join_url, provider_meeting_id, video_provider
       FROM meeting_sessions
       WHERE id = $1
       LIMIT 1`,
      [String(meetingId)]
    );
    const meeting = existsResp.rows[0] || null;
    if (!meeting) throw Object.assign(new Error('Meeting not found'), { statusCode: 404, code: 'MEETING_NOT_FOUND' });

    let provider = normalizeProvider(meeting?.video_provider || payload?.provider || 'livekit');
    let providerMeetingId = String(meeting?.provider_meeting_id || '').trim() || null;
    let joinUrl = payload?.joinUrl ? String(payload.joinUrl).trim() : String(meeting?.join_url || '').trim() || null;

    if (provider === 'livekit' && joinUrl && !isValidLiveKitUrl(joinUrl)) {
      joinUrl = null;
    }

    if (provider === 'livekit' && !joinUrl) {
      const durationMinutes = getMeetingDurationMinutes(meeting.scheduled_start, meeting.scheduled_end);
      const created = await this.createDailyRoom(String(meetingId), durationMinutes);
      joinUrl = created.joinUrl;
      providerMeetingId = providerMeetingId || created.providerMeetingId;
      provider = 'livekit';
    }

    if (provider === 'livekit' && joinUrl && !isValidLiveKitUrl(joinUrl)) {
      throw Object.assign(new Error('joinUrl must be a valid LiveKit URL'), {
        statusCode: 400,
        code: 'LIVEKIT_INVALID_JOIN_URL',
        detail: 'Expected a ws://, wss://, or https:// URL when provider is livekit.',
      });
    }

    if (!providerMeetingId && joinUrl) {
      providerMeetingId = `livekit-${crypto.randomUUID().slice(0, 12)}`;
    }

    await orgPool.query(
      `UPDATE meeting_sessions
       SET video_provider = $2,
           provider_meeting_id = $3,
           join_url = $4,
           status = CASE WHEN status = 'scheduled' THEN 'in_progress' ELSE status END,
           actual_start = COALESCE(actual_start, NOW()),
           updated_by = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [String(meetingId), provider || null, providerMeetingId || null, joinUrl || null, String(actorMemberId)]
    );

    return this.getById(req, meetingId);
  }

  getHealth() {
    const livekitUrl = String(process.env.LIVEKIT_URL || '').trim();
    const livekitApiKey = String(process.env.LIVEKIT_API_KEY || '').trim();

    return {
      status: 'ok',
      livekit: {
        configured: Boolean(livekitApiKey) && Boolean(livekitUrl),
        apiKeySet: Boolean(livekitApiKey),
        urlSet: Boolean(livekitUrl),
        url: livekitUrl || null,
      },
    };
  }

  async createMeetingRoomToken(req, payload) {
    const apiKey = String(process.env.LIVEKIT_API_KEY || '').trim();
    const apiSecret = String(process.env.LIVEKIT_API_SECRET || '').trim();
    const livekitUrl = String(process.env.LIVEKIT_URL || '').trim();

    if (!apiKey || !apiSecret || !isValidLiveKitUrl(livekitUrl)) {
      throw Object.assign(new Error('LiveKit is not configured'), {
        statusCode: 500,
        code: 'LIVEKIT_CONFIG_MISSING',
        detail: 'Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_URL in environment.',
      });
    }

    const roomName = String(payload.roomName || '').trim();
    const participantName = String(payload.participantName || '').trim();
    const identity = `${participantName}-${crypto.randomUUID().slice(0, 8)}`;

    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const roomResp = await orgPool.query(
      `SELECT id, status FROM meeting_rooms WHERE org_id = $1 AND room_name = $2 LIMIT 1`,
      [orgId, roomName]
    );
    const room = roomResp.rows[0] || null;
    if (!room) {
      throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });
    }
    if (String(room.status || '').toLowerCase() === 'ended') {
      throw Object.assign(new Error('Meeting room already ended'), { statusCode: 409, code: 'MEETING_ROOM_ENDED' });
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name: participantName,
      metadata: JSON.stringify({
        userId: String(req.user?.userId || ''),
        orgId: String(req.user?.orgId || ''),
      }),
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canPublishData: true,
      canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE],
      canSubscribe: true,
    });

    const jwt = await token.toJwt();
    return { token: jwt, url: livekitUrl, identity };
  }

  async createMeetingRoom(req, payload) {
    requireMeetingAdmin(req);
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const createdBy = String(req.user?.userId || '').trim();
    const roomName = String(payload.roomName || '').trim();
    const meetingKind = normalizeMeetingKind(payload.meetingKind);
    const normalCategory = normalizeNormalCategory(payload.normalCategory);
    const title = payload.title ? String(payload.title).trim() : null;
    const description = payload.description ? String(payload.description).trim() : null;
    const scheduledForRaw = String(payload.scheduledFor || '').trim();
    const scheduledFor = scheduledForRaw ? new Date(scheduledForRaw) : null;

    if (!orgId || !createdBy) {
      throw Object.assign(new Error('Invalid token context for meeting room creation'), {
        statusCode: 401,
        code: 'MEETING_ROOM_AUTH_CONTEXT_MISSING',
      });
    }

    if (scheduledFor && Number.isNaN(scheduledFor.getTime())) {
      throw Object.assign(new Error('Invalid scheduledFor timestamp'), {
        statusCode: 400,
        code: 'MEETING_ROOM_SCHEDULE_INVALID',
      });
    }

    const resp = await orgPool.query(
      `INSERT INTO meeting_rooms (org_id, room_name, created_by, meeting_kind, normal_category, title, description, scheduled_for)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (org_id, room_name)
       DO UPDATE SET status = 'active', ended_at = NULL, meeting_kind = EXCLUDED.meeting_kind, normal_category = EXCLUDED.normal_category,
                     title = COALESCE(EXCLUDED.title, meeting_rooms.title), description = COALESCE(EXCLUDED.description, meeting_rooms.description),
                     scheduled_for = COALESCE(EXCLUDED.scheduled_for, meeting_rooms.scheduled_for)
       RETURNING id, org_id, room_name, created_by, meeting_kind, normal_category, title, description, scheduled_for, transcript, summary, status, created_at, ended_at`,
      [orgId, roomName, createdBy, meetingKind, normalCategory, title, description, scheduledFor]
    );

    const row = resp.rows[0] || null;
    return row ? mapMeetingRoomRow(row) : null;
  }

  async joinMeetingRoomParticipant(req, payload) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const userId = String(req.user?.userId || '').trim();
    const roomName = String(payload.roomName || '').trim();
    const participantName = String(payload.participantName || '').trim() || 'Team Member';
    const identity = String(payload.identity || '').trim() || null;
    const role = String(payload.role || 'member').trim() || 'member';

    const roomResp = await orgPool.query(
      `SELECT id, status FROM meeting_rooms WHERE org_id = $1 AND room_name = $2 LIMIT 1`,
      [orgId, roomName]
    );
    const room = roomResp.rows[0] || null;
    if (!room) throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });

    if (String(room.status || '').toLowerCase() === 'ended') {
      throw Object.assign(new Error('Meeting room already ended'), { statusCode: 409, code: 'MEETING_ROOM_ENDED' });
    }

    const participantResp = await orgPool.query(
      `INSERT INTO meeting_room_participants (room_id, org_id, user_id, participant_name, identity, role, status, left_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NULL, NOW())
       ON CONFLICT (room_id, user_id)
       DO UPDATE SET
         participant_name = EXCLUDED.participant_name,
         identity = COALESCE(EXCLUDED.identity, meeting_room_participants.identity),
         role = EXCLUDED.role,
         status = 'active',
         left_at = NULL,
         last_seen_at = NOW()
       RETURNING id, room_id, org_id, user_id, participant_name, identity, role, status, joined_at, left_at, last_seen_at, participation_notes`,
      [room.id, orgId, userId, participantName, identity, role]
    );

    const participant = mapParticipantRow(participantResp.rows[0] || {});
    emitToOrg(orgId, 'meeting:participant:joined', {
      roomName,
      participant,
      orgId,
    });

    return participant;
  }

  async listMeetingRoomParticipants(req, roomNameRaw) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const roomName = String(roomNameRaw || '').trim();
    const roomResp = await orgPool.query(
      `SELECT id FROM meeting_rooms WHERE org_id = $1 AND room_name = $2 LIMIT 1`,
      [orgId, roomName]
    );
    const room = roomResp.rows[0] || null;
    if (!room) throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });

    const resp = await orgPool.query(
      `SELECT id, room_id, org_id, user_id, participant_name, identity, role, status, joined_at, left_at, last_seen_at, participation_notes
       FROM meeting_room_participants
       WHERE room_id = $1
       ORDER BY joined_at ASC`,
      [room.id]
    );

    return resp.rows.map((row) => mapParticipantRow(row));
  }

  async updateMeetingRoomParticipant(req, roomNameRaw, participantIdRaw, payload) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const roomName = String(roomNameRaw || '').trim();
    const participantId = String(participantIdRaw || '').trim();

    const roomResp = await orgPool.query(
      `SELECT id FROM meeting_rooms WHERE org_id = $1 AND room_name = $2 LIMIT 1`,
      [orgId, roomName]
    );
    const room = roomResp.rows[0] || null;
    if (!room) throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });

    const role = payload.role ? String(payload.role).trim() : null;
    const status = payload.status ? String(payload.status).trim() : null;
    const participationNotes = payload.participationNotes !== undefined ? String(payload.participationNotes || '').trim() : null;

    const sets = [];
    const params = [room.id, participantId];

    if (role !== null) {
      params.push(role);
      sets.push(`role = $${params.length}`);
    }

    if (status !== null) {
      params.push(status);
      sets.push(`status = $${params.length}`);
      sets.push(`left_at = CASE WHEN $${params.length} = 'left' THEN COALESCE(left_at, NOW()) WHEN $${params.length} = 'active' THEN NULL ELSE left_at END`);
    }

    if (participationNotes !== null) {
      params.push(participationNotes);
      sets.push(`participation_notes = $${params.length}`);
    }

    sets.push('last_seen_at = NOW()');

    const resp = await orgPool.query(
      `UPDATE meeting_room_participants
       SET ${sets.join(', ')}
       WHERE room_id = $1 AND id = $2
       RETURNING id, room_id, org_id, user_id, participant_name, identity, role, status, joined_at, left_at, last_seen_at, participation_notes`,
      params
    );

    const row = resp.rows[0] || null;
    if (!row) {
      throw Object.assign(new Error('Participant not found in meeting room'), {
        statusCode: 404,
        code: 'MEETING_PARTICIPANT_NOT_FOUND',
      });
    }

    return mapParticipantRow(row);
  }

  async removeMeetingRoomParticipant(req, roomNameRaw, participantIdRaw) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const roomName = String(roomNameRaw || '').trim();
    const participantId = String(participantIdRaw || '').trim();

    const roomResp = await orgPool.query(
      `SELECT id FROM meeting_rooms WHERE org_id = $1 AND room_name = $2 LIMIT 1`,
      [orgId, roomName]
    );
    const room = roomResp.rows[0] || null;
    if (!room) throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });

    const resp = await orgPool.query(
      `DELETE FROM meeting_room_participants
       WHERE room_id = $1 AND id = $2
       RETURNING id, room_id, org_id, user_id, participant_name, identity, role, status, joined_at, left_at, last_seen_at, participation_notes`,
      [room.id, participantId]
    );

    const row = resp.rows[0] || null;
    if (!row) {
      throw Object.assign(new Error('Participant not found in meeting room'), {
        statusCode: 404,
        code: 'MEETING_PARTICIPANT_NOT_FOUND',
      });
    }

    return mapParticipantRow({ ...row, status: 'removed' });
  }

  async leaveMeetingRoomParticipant(req, roomNameRaw, payload) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const roomName = String(roomNameRaw || '').trim();
    const userId = String(payload?.userId || req.user?.userId || '').trim();

    const roomResp = await orgPool.query(
      `SELECT id FROM meeting_rooms WHERE org_id = $1 AND room_name = $2 LIMIT 1`,
      [orgId, roomName]
    );
    const room = roomResp.rows[0] || null;
    if (!room) throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });

    const resp = await orgPool.query(
      `UPDATE meeting_room_participants
       SET status = 'left', left_at = COALESCE(left_at, NOW()), last_seen_at = NOW()
       WHERE room_id = $1 AND user_id = $2
       RETURNING id, room_id, org_id, user_id, participant_name, identity, role, status, joined_at, left_at, last_seen_at, participation_notes`,
      [room.id, userId]
    );

    const row = resp.rows[0] || null;
    if (!row) {
      throw Object.assign(new Error('Participant not found in meeting room'), {
        statusCode: 404,
        code: 'MEETING_PARTICIPANT_NOT_FOUND',
      });
    }

    const participant = mapParticipantRow(row);
    emitToOrg(orgId, 'meeting:participant:left', {
      roomName,
      participant,
      orgId,
    });

    return participant;
  }

  async listMeetingRoomIndividualSummaries(req, roomNameRaw) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const roomName = String(roomNameRaw || '').trim();
    const roomResp = await orgPool.query(
      `SELECT id FROM meeting_rooms WHERE org_id = $1 AND room_name = $2 LIMIT 1`,
      [orgId, roomName]
    );
    const room = roomResp.rows[0] || null;
    if (!room) throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });

    const resp = await orgPool.query(
      `SELECT id, room_id, participant_id, user_id, participant_name, summary, action_items, generated_at, updated_at
       FROM meeting_room_individual_summaries
       WHERE room_id = $1
       ORDER BY generated_at DESC`,
      [room.id]
    );

    return resp.rows.map((row) => ({
      id: row.id,
      roomId: row.room_id,
      participantId: row.participant_id,
      userId: row.user_id,
      participantName: row.participant_name,
      summary: row.summary || '',
      actionItems: row.action_items || '',
      generatedAt: row.generated_at,
      updatedAt: row.updated_at,
    }));
  }

  async generateIndividualMeetingRoomSummary(req, payload) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const userId = String(req.user?.userId || '').trim();
    const roomName = String(payload.roomName || '').trim();
    const requestedParticipantId = String(payload.participantId || '').trim();
    const focus = String(payload.focus || '').trim();

    const roomResp = await orgPool.query(
      `SELECT id, transcript FROM meeting_rooms WHERE org_id = $1 AND room_name = $2 LIMIT 1`,
      [orgId, roomName]
    );
    const room = roomResp.rows[0] || null;
    if (!room) throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });

    const participantResp = requestedParticipantId
      ? await orgPool.query(
          `SELECT id, user_id, participant_name FROM meeting_room_participants WHERE room_id = $1 AND id = $2 LIMIT 1`,
          [room.id, requestedParticipantId]
        )
      : await orgPool.query(
          `SELECT id, user_id, participant_name
           FROM meeting_room_participants
           WHERE room_id = $1 AND user_id = $2
           ORDER BY joined_at DESC
           LIMIT 1`,
          [room.id, userId]
        );

    const participant = participantResp.rows[0] || null;
    if (!participant) {
      throw Object.assign(new Error('Participant not found in meeting room'), {
        statusCode: 404,
        code: 'MEETING_PARTICIPANT_NOT_FOUND',
      });
    }

    const transcript = String(room.transcript || '').trim();
    if (!transcript) {
      throw Object.assign(new Error('Transcript is required before generating individual summary'), {
        statusCode: 409,
        code: 'MEETING_TRANSCRIPT_REQUIRED',
      });
    }

    let summary = '';
    try {
      summary = await summarizeParticipantMeetingRoomTranscript(transcript, participant.participant_name, focus);
    } catch {
      summary = individualSummaryFallback(participant.participant_name);
    }

    const upsertResp = await orgPool.query(
      `INSERT INTO meeting_room_individual_summaries (room_id, org_id, participant_id, user_id, participant_name, summary, action_items)
       VALUES ($1, $2, $3, $4, $5, $6, '')
       ON CONFLICT (room_id, user_id)
       DO UPDATE SET
         participant_id = EXCLUDED.participant_id,
         participant_name = EXCLUDED.participant_name,
         summary = EXCLUDED.summary,
         updated_at = NOW(),
         generated_at = NOW()
       RETURNING id, room_id, participant_id, user_id, participant_name, summary, action_items, generated_at, updated_at`,
      [room.id, orgId, participant.id, participant.user_id, participant.participant_name, summary]
    );

    const row = upsertResp.rows[0] || null;
    return {
      id: row.id,
      roomId: row.room_id,
      participantId: row.participant_id,
      userId: row.user_id,
      participantName: row.participant_name,
      summary: row.summary || '',
      actionItems: row.action_items || '',
      generatedAt: row.generated_at,
      updatedAt: row.updated_at,
    };
  }

  async listMeetingRooms(req) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const userId = String(req.user?.userId || '').trim();
    const resp = await orgPool.query(
      `SELECT mr.id,
              mr.org_id,
              mr.room_name,
              mr.created_by,
              mr.meeting_kind,
              mr.normal_category,
              mr.title,
              mr.description,
              mr.scheduled_for,
              mr.transcript,
              mr.summary,
              mr.status,
              mr.created_at,
              mr.ended_at,
              mis.summary AS my_summary,
              mis.generated_at AS my_summary_generated_at
       FROM meeting_rooms mr
       LEFT JOIN meeting_room_individual_summaries mis
         ON mis.room_id = mr.id
        AND mis.user_id = $2
       WHERE mr.org_id = $1
       ORDER BY mr.created_at DESC`,
      [orgId, userId]
    );

    return resp.rows.map((row) => mapMeetingRoomRow(row));
  }

  async getMeetingRoomById(req, roomIdRaw) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const userId = String(req.user?.userId || '').trim();
    const roomId = String(roomIdRaw || '').trim();

    const roomResp = await orgPool.query(
      `SELECT mr.id,
              mr.org_id,
              mr.room_name,
              mr.created_by,
              mr.meeting_kind,
              mr.normal_category,
              mr.title,
              mr.description,
              mr.scheduled_for,
              mr.transcript,
              mr.summary,
              mr.status,
              mr.created_at,
              mr.ended_at,
              mis.summary AS my_summary,
              mis.generated_at AS my_summary_generated_at
       FROM meeting_rooms mr
       LEFT JOIN meeting_room_individual_summaries mis
         ON mis.room_id = mr.id
        AND mis.user_id = $3
       WHERE mr.org_id = $1
         AND mr.id = $2
       LIMIT 1`,
      [orgId, roomId, userId]
    );

    const room = roomResp.rows[0] || null;
    if (!room) {
      throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });
    }

    const [participantsResp, summariesResp] = await Promise.all([
      orgPool.query(
        `SELECT id, room_id, org_id, user_id, participant_name, identity, role, status, joined_at, left_at, last_seen_at, participation_notes
         FROM meeting_room_participants
         WHERE room_id = $1
         ORDER BY joined_at ASC`,
        [roomId]
      ),
      orgPool.query(
        `SELECT id, room_id, participant_id, user_id, participant_name, summary, action_items, generated_at, updated_at
         FROM meeting_room_individual_summaries
         WHERE room_id = $1
         ORDER BY generated_at DESC`,
        [roomId]
      ),
    ]);

    return {
      ...mapMeetingRoomRow(room),
      participants: participantsResp.rows.map((item) => mapParticipantRow(item)),
      individualSummaries: summariesResp.rows.map((item) => ({
        id: item.id,
        roomId: item.room_id,
        participantId: item.participant_id,
        userId: item.user_id,
        participantName: item.participant_name,
        summary: item.summary || '',
        actionItems: item.action_items || '',
        generatedAt: item.generated_at,
        updatedAt: item.updated_at,
      })),
    };
  }

  async listMeetingRoomMessages(req, roomNameRaw, limitRaw) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const roomName = String(roomNameRaw || '').trim();
    const limit = Number(limitRaw || 200);
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 500)) : 200;

    const roomResp = await orgPool.query(
      `SELECT id FROM meeting_rooms WHERE org_id = $1 AND room_name = $2 LIMIT 1`,
      [orgId, roomName]
    );
    const room = roomResp.rows[0] || null;
    if (!room) throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });

    const resp = await orgPool.query(
      `SELECT id, room_id, org_id, user_id, participant_name, message, created_at
       FROM meeting_room_messages
       WHERE room_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [room.id, boundedLimit]
    );

    return resp.rows.map((item) => mapMeetingRoomMessageRow(item));
  }

  async createMeetingRoomMessage(req, payload) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const userId = String(req.user?.userId || '').trim();
    const roomName = String(payload.roomName || '').trim();
    const participantName = String(payload.participantName || 'Team Member').trim() || 'Team Member';
    const message = String(payload.message || '').trim();

    const roomResp = await orgPool.query(
      `SELECT id, status FROM meeting_rooms WHERE org_id = $1 AND room_name = $2 LIMIT 1`,
      [orgId, roomName]
    );
    const room = roomResp.rows[0] || null;
    if (!room) throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });

    if (String(room.status || '').toLowerCase() === 'ended') {
      throw Object.assign(new Error('Meeting has already ended'), { statusCode: 409, code: 'MEETING_ROOM_ENDED' });
    }

    const insertResp = await orgPool.query(
      `INSERT INTO meeting_room_messages (room_id, org_id, user_id, participant_name, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, room_id, org_id, user_id, participant_name, message, created_at`,
      [room.id, orgId, userId, participantName, message]
    );

    return mapMeetingRoomMessageRow(insertResp.rows[0] || {});
  }

  async saveMeetingRoomTranscript(req, payload) {
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const roomName = String(payload.roomName || '').trim();
    const transcript = String(payload.transcript || '').trim();

    const updateResp = await orgPool.query(
      `UPDATE meeting_rooms
       SET transcript = CASE WHEN $1 <> '' THEN $1 ELSE transcript END
       WHERE org_id = $2 AND room_name = $3
       RETURNING id, room_name, transcript`,
      [transcript, orgId, roomName]
    );

    const room = updateResp.rows[0] || null;
    if (!room) throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });

    const effectiveTranscript = String(room.transcript || '').trim();
    let summary = '';
    let summaryEngine = 'fallback-no-transcript';
    let groqUsed = false;
    if (!effectiveTranscript) {
      summary = '## Summary\nMeeting ended successfully, but no transcript text was captured.\n\n## Key Decisions\n- Not available.\n\n## Action Items (with owner if mentioned)\n- Not available.\n\n## Blockers\n- Not available.';
    } else {
      try {
        summary = await summarizeMeetingRoomTranscript(effectiveTranscript);
        summaryEngine = 'groq';
        groqUsed = true;
      } catch {
        summaryEngine = 'fallback-groq-error';
        summary = '## Summary\nUnable to generate summary from transcript right now.\n\n## Key Decisions\n- Not available.\n\n## Action Items (with owner if mentioned)\n- Not available.\n\n## Blockers\n- Not available.';
      }
    }

    await orgPool.query(
      `UPDATE meeting_rooms
       SET summary = $1
       WHERE org_id = $2 AND room_name = $3`,
      [summary, orgId, roomName]
    );

    emitToOrg(orgId, 'meeting:summary', {
      roomName,
      summary,
      meetingId: room.id,
      orgId,
    });

    return {
      summary,
      captured: Boolean(transcript),
      charCount: transcript.length,
      summaryEngine,
      groqUsed,
      transcriptPersisted: Boolean(effectiveTranscript),
    };
  }

  async endMeetingRoom(req, roomNameRaw) {
    requireMeetingAdmin(req);
    const orgPool = requireOrgDb(req);
    await ensureMeetingRoomsTable(orgPool);

    const orgId = String(req.user?.orgId || '').trim();
    const roomName = String(roomNameRaw || '').trim();
    const resp = await orgPool.query(
      `UPDATE meeting_rooms
       SET status = 'ended', ended_at = NOW()
       WHERE org_id = $1 AND room_name = $2
       RETURNING id, org_id, room_name, created_by, transcript, summary, status, created_at, ended_at`,
      [orgId, roomName]
    );

    const row = resp.rows[0] || null;
    if (!row) throw Object.assign(new Error('Meeting room not found'), { statusCode: 404, code: 'MEETING_ROOM_NOT_FOUND' });

    try {
      await orgPool.query(
        `UPDATE meeting_room_participants
         SET status = CASE WHEN status = 'active' THEN 'left' ELSE status END,
             left_at = CASE WHEN status = 'active' THEN COALESCE(left_at, NOW()) ELSE left_at END,
             last_seen_at = NOW()
         WHERE room_id = $1`,
        [row.id]
      );
    } catch (participantUpdateErr) {
      console.warn('meeting.end.participant_status_update_failed', {
        roomId: String(row.id),
        orgId,
        message: String(participantUpdateErr?.message || participantUpdateErr),
      });
    }

    let participantsResp = { rows: [] };
    try {
      participantsResp = await orgPool.query(
        `SELECT id, user_id, participant_name
         FROM meeting_room_participants
         WHERE room_id = $1
         ORDER BY joined_at ASC`,
        [row.id]
      );
    } catch (participantsLoadErr) {
      console.warn('meeting.end.participants_load_failed', {
        roomId: String(row.id),
        orgId,
        message: String(participantsLoadErr?.message || participantsLoadErr),
      });
    }

    const transcript = String(row.transcript || '').trim();
    const individualSummaries = (
      await Promise.all(
        (Array.isArray(participantsResp.rows) ? participantsResp.rows : []).map(async (participant) => {
          try {
            let individualSummary = '';
            if (!transcript) {
              individualSummary = individualSummaryFallback(participant.participant_name);
            } else {
              try {
                individualSummary = await summarizeParticipantMeetingRoomTranscript(
                  transcript,
                  participant.participant_name,
                  'Focus on responsibilities and next actions for this person.'
                );
              } catch {
                individualSummary = individualSummaryFallback(participant.participant_name);
              }
            }

            const summaryResp = await orgPool.query(
              `INSERT INTO meeting_room_individual_summaries (room_id, org_id, participant_id, user_id, participant_name, summary, action_items)
               VALUES ($1, $2, $3, $4, $5, $6, '')
               ON CONFLICT (room_id, user_id)
               DO UPDATE SET
                 participant_id = EXCLUDED.participant_id,
                 participant_name = EXCLUDED.participant_name,
                 summary = EXCLUDED.summary,
                 updated_at = NOW(),
                 generated_at = NOW()
               RETURNING id, room_id, participant_id, user_id, participant_name, summary, action_items, generated_at, updated_at`,
              [row.id, orgId, participant.id, participant.user_id, participant.participant_name, individualSummary]
            );

            const item = summaryResp.rows[0] || null;
            if (!item) return null;
            return {
              id: item.id,
              roomId: item.room_id,
              participantId: item.participant_id,
              userId: item.user_id,
              participantName: item.participant_name,
              summary: item.summary || '',
              actionItems: item.action_items || '',
              generatedAt: item.generated_at,
              updatedAt: item.updated_at,
            };
          } catch (participantSummaryErr) {
            console.warn('meeting.end.participant_summary_failed', {
              roomId: String(row.id),
              orgId,
              participantId: String(participant?.id || ''),
              userId: String(participant?.user_id || ''),
              message: String(participantSummaryErr?.message || participantSummaryErr),
            });
            return null;
          }
        })
      )
    ).filter(Boolean);

    const actorUserId = String(req.user?.userId || '').trim();
    const myIndividualSummary = individualSummaries.find((item) => item.userId === actorUserId) || null;

    return {
      id: row.id,
      orgId: row.org_id,
      roomName: row.room_name,
      createdBy: row.created_by,
      transcript: row.transcript || '',
      summary: row.summary || '',
      mySummary: myIndividualSummary?.summary || '',
      status: row.status,
      createdAt: row.created_at,
      endedAt: row.ended_at,
      individualSummaries,
    };
  }

  async listTranscripts(req, meetingId) {
    const orgPool = requireOrgDb(req);

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404, code: 'MEETING_NOT_FOUND' });

    const resp = await orgPool.query(
      `SELECT
         mt.id,
         mt.meeting_id,
         mt.source_type,
         mt.file_name,
         mt.mime_type,
         mt.transcript_text,
         mt.speaker_segments,
         mt.language,
         mt.status,
         mt.error_message,
         mt.uploaded_by,
         mt.created_at,
         mt.updated_at
       FROM meeting_transcripts mt
       WHERE mt.meeting_id = $1
       ORDER BY mt.created_at DESC`,
      [String(meetingId)]
    );

    return resp.rows.map((item) => ({
      id: item.id,
      meetingId: item.meeting_id,
      sourceType: item.source_type,
      fileName: item.file_name,
      mimeType: item.mime_type,
      transcriptText: item.transcript_text,
      speakerSegments: Array.isArray(item.speaker_segments) ? item.speaker_segments : [],
      language: item.language,
      status: item.status,
      errorMessage: item.error_message,
      uploadedBy: item.uploaded_by,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));
  }

  async uploadTranscript(req, meetingId, payload) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403, code: 'TEAM_MEMBER_NOT_FOUND' });

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404, code: 'MEETING_NOT_FOUND' });

    const transcriptText = String(payload?.transcriptText || '').trim();
    if (!transcriptText) throw Object.assign(new Error('Transcript text is required'), { statusCode: 400, code: 'TRANSCRIPT_REQUIRED' });

    const sourceType = String(payload?.sourceType || 'manual_upload');
    const fileName = payload?.fileName ? String(payload.fileName) : null;
    const mimeType = payload?.mimeType ? String(payload.mimeType) : null;
    const language = payload?.language ? String(payload.language) : null;
    const normalizedTranscript = normalizeTranscriptInput({
      transcriptText,
      fileName,
      mimeType,
      speakerSegments: payload?.speakerSegments,
    });
    const speakerSegments = Array.isArray(normalizedTranscript.speakerSegments) ? normalizedTranscript.speakerSegments : [];

    const insertResp = await orgPool.query(
      `INSERT INTO meeting_transcripts (
         meeting_id,
         source_type,
         file_name,
         mime_type,
         transcript_text,
         speaker_segments,
         language,
         status,
         uploaded_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ready',$8)
       RETURNING
         id,
         meeting_id,
         source_type,
         file_name,
         mime_type,
         transcript_text,
         speaker_segments,
         language,
         status,
         error_message,
         uploaded_by,
         created_at,
         updated_at`,
      [
        String(meetingId),
        sourceType,
        fileName,
        mimeType,
        normalizedTranscript.transcriptText,
        speakerSegments,
        language,
        String(actorMemberId),
      ]
    );

    await orgPool.query('UPDATE meeting_sessions SET updated_by = $2, updated_at = NOW() WHERE id = $1', [
      String(meetingId),
      String(actorMemberId),
    ]);

    const row = insertResp.rows[0];
    return {
      id: row.id,
      meetingId: row.meeting_id,
      sourceType: row.source_type,
      fileName: row.file_name,
      mimeType: row.mime_type,
      transcriptText: row.transcript_text,
      speakerSegments: Array.isArray(row.speaker_segments) ? row.speaker_segments : [],
      language: row.language,
      status: row.status,
      errorMessage: row.error_message,
      uploadedBy: row.uploaded_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async summarizeMeeting(req, meetingId, payload) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403, code: 'TEAM_MEMBER_NOT_FOUND' });

    const existsResp = await orgPool.query('SELECT id FROM meeting_sessions WHERE id = $1 LIMIT 1', [String(meetingId)]);
    if (!existsResp.rows.length) throw Object.assign(new Error('Meeting not found'), { statusCode: 404, code: 'MEETING_NOT_FOUND' });

    const includeNotes = payload?.includeNotes !== false;
    const updateDescription = payload?.updateDescription !== false;

    let sourceText = String(payload?.sourceText || '').trim();

    if (!sourceText) {
      const transcriptResp = await orgPool.query(
        `SELECT transcript_text FROM meeting_transcripts WHERE meeting_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [String(meetingId)]
      );
      sourceText = String(transcriptResp.rows[0]?.transcript_text || '').trim();
    }

    const noteLines = [];
    if (includeNotes) {
      const notesResp = await orgPool.query(
        `SELECT content FROM meeting_notes WHERE meeting_id = $1 ORDER BY created_at DESC LIMIT 30`,
        [String(meetingId)]
      );
      const noteText = notesResp.rows.map((row) => String(row.content || '').trim()).filter(Boolean).join('\n');
      noteLines.push(...notesResp.rows.map((row) => String(row.content || '').trim()).filter(Boolean));
      if (noteText) sourceText = sourceText ? `${sourceText}\n${noteText}` : noteText;
    }

    let generated = null;
    const meetingResp = await orgPool.query(
      `SELECT title, meeting_type FROM meeting_sessions WHERE id = $1 LIMIT 1`,
      [String(meetingId)]
    );
    const meetingRow = meetingResp.rows[0] || null;

    try {
      generated = await summarizeViaGroq({
        meetingTitle: meetingRow?.title || null,
        meetingType: meetingRow?.meeting_type || null,
        sourceText,
        notes: noteLines,
      });
    } catch {
      generated = buildGeneratedDescription(sourceText);
    }

    const sets = [];
    const params = [];
    const addSet = (field, value) => {
      params.push(value);
      sets.push(`${field} = $${params.length}`);
    };

    if (updateDescription) addSet('description', generated.description || null);
    addSet('ai_summary', generated.aiSummary);
    addSet('ai_decisions', generated.aiDecisions);
    addSet('ai_risks', generated.aiRisks);
    addSet('ai_action_items', generated.aiActionItems);
    addSet('updated_by', String(actorMemberId));

    params.push(String(meetingId));

    await orgPool.query(
      `UPDATE meeting_sessions
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length}`,
      params
    );

    const historyContent = [
      generated.aiSummary ? `Summary:\n${generated.aiSummary}` : null,
      generated.aiDecisions ? `Decisions:\n${generated.aiDecisions}` : null,
      generated.aiRisks ? `Risks:\n${generated.aiRisks}` : null,
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim();

    if (historyContent) {
      await orgPool.query(
        `INSERT INTO meeting_notes (meeting_id, author_member_id, content, is_ai_generated)
         VALUES ($1,$2,$3,TRUE)`,
        [String(meetingId), String(actorMemberId), historyContent]
      );
    }

    return this.getById(req, meetingId);
  }
}

const meetingsService = new MeetingsService();

module.exports = {
  meetingsService,
};
