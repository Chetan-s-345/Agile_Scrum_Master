function requireOrgDb(req) {
  const pool = req.orgDb;
  if (!pool) throw Object.assign(new Error('Org DB not attached'), { statusCode: 500 });
  return pool;
}

function toIsoDate(value) {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function extractSections(rawInput) {
  const text = String(rawInput || '').trim();
  const normalized = text.replace(/\r\n/g, '\n');

  const getSection = (names) => {
    const lines = normalized.split('\n');
    const nameRegex = new RegExp(`^\\s*(?:${names.join('|')})\\s*:\\s*(.*)$`, 'i');
    const starts = lines
      .map((line, idx) => ({ line, idx, match: line.match(nameRegex) }))
      .filter((x) => x.match);

    if (!starts.length) return null;
    const first = starts[0];
    const startIdx = first.idx;
    const collected = [];

    for (let i = startIdx; i < lines.length; i++) {
      if (i === startIdx) {
        collected.push(String(first.match[1] || '').trim());
        continue;
      }
      if (/^\s*[a-z][a-z\s_-]{1,30}\s*:/i.test(lines[i])) break;
      collected.push(lines[i].trim());
    }

    return collected.join(' ').trim() || null;
  };

  const completed = getSection(['yesterday', 'completed', 'done']);
  const planned = getSection(['today', 'planned', 'next']);
  const blockers = getSection(['blockers?', 'blocked', 'blocker']);

  return {
    completedWork: completed,
    plannedWork: planned,
    blockers,
    hasBlockers: Boolean(blockers && blockers.length > 0),
  };
}

async function getActorMemberAndDeveloper(orgPool, userId) {
  const memberResp = await orgPool.query('SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1', [String(userId)]);
  const memberId = memberResp.rows[0]?.id || null;
  if (!memberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

  const devResp = await orgPool.query('SELECT id FROM developer_profiles WHERE member_id = $1 LIMIT 1', [String(memberId)]);
  const developerId = devResp.rows[0]?.id || null;
  if (!developerId) {
    throw Object.assign(
      new Error('Developer profile not found for current user. Create one from Developers page before submitting standup.'),
      { statusCode: 400 }
    );
  }

  return { memberId: String(memberId), developerId: String(developerId) };
}

async function resolveSprintId(orgPool, sprintId) {
  if (sprintId) {
    const row = await orgPool.query('SELECT id, project_id FROM sprints WHERE id = $1 LIMIT 1', [String(sprintId)]);
    const sprint = row.rows[0];
    if (!sprint) throw Object.assign(new Error('Sprint not found'), { statusCode: 404 });
    return { sprintId: String(sprint.id), projectId: String(sprint.project_id) };
  }

  const active = await orgPool.query("SELECT id, project_id FROM sprints WHERE status = 'active' ORDER BY start_date DESC LIMIT 1");
  const selected = active.rows[0];
  if (selected) return { sprintId: String(selected.id), projectId: String(selected.project_id) };

  const planning = await orgPool.query("SELECT id, project_id FROM sprints WHERE status = 'planning' ORDER BY start_date DESC LIMIT 1");
  const fallback = planning.rows[0];
  if (!fallback) {
    throw Object.assign(new Error('No planning/active sprint found. Create or start a sprint first.'), { statusCode: 400 });
  }
  return { sprintId: String(fallback.id), projectId: String(fallback.project_id) };
}

class StandupService {
  async create(req, payload) {
    const orgPool = requireOrgDb(req);
    const { memberId, developerId } = await getActorMemberAndDeveloper(orgPool, req.user?.userId);
    const { sprintId, projectId } = await resolveSprintId(orgPool, payload.sprintId);

    const parsed = extractSections(payload.rawInput);

    await orgPool.query('BEGIN');
    try {
      const upsertResp = await orgPool.query(
        `INSERT INTO standup_entries (
           sprint_id, developer_id, entry_date, raw_input, input_channel,
           completed_work, planned_work, blockers, ai_summary, has_blockers, processed, processed_at
         )
         VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,$6,$7,$8,$9,TRUE,NOW())
         ON CONFLICT (sprint_id, developer_id, entry_date)
         DO UPDATE SET
           raw_input = EXCLUDED.raw_input,
           input_channel = EXCLUDED.input_channel,
           completed_work = EXCLUDED.completed_work,
           planned_work = EXCLUDED.planned_work,
           blockers = EXCLUDED.blockers,
           ai_summary = EXCLUDED.ai_summary,
           has_blockers = EXCLUDED.has_blockers,
           processed = TRUE,
           processed_at = NOW()
         RETURNING *`,
        [
          String(sprintId),
          String(developerId),
          String(payload.rawInput),
          String(payload.inputChannel || 'web'),
          parsed.completedWork,
          parsed.plannedWork,
          parsed.blockers,
          parsed.completedWork && parsed.plannedWork
            ? `Completed: ${parsed.completedWork} | Planned: ${parsed.plannedWork}`
            : String(payload.rawInput).slice(0, 500),
          Boolean(parsed.hasBlockers),
        ]
      );

      const standup = upsertResp.rows[0];

      let blockerTaskIds = [];
      if (parsed.hasBlockers) {
        const blockerTitle = `Blocker: ${String(parsed.blockers || 'Needs attention').slice(0, 120)}`;
        const blockerResp = await orgPool.query(
          `INSERT INTO tasks (
             sprint_id, project_id, title, description, type, status, priority, story_points,
             tech_tags, acceptance_criteria, created_by, assignee_id
           )
           VALUES ($1,$2,$3,$4,'task','blocked','high',1,$5,$6,$7,$8)
           RETURNING id`,
          [
            String(sprintId),
            String(projectId),
            blockerTitle,
            `Auto-created from standup blocker\n\n${String(parsed.blockers || '')}`,
            [],
            'Resolve blocker and update standup entry',
            String(memberId),
            String(developerId),
          ]
        );

        blockerTaskIds = blockerResp.rows.map((r) => r.id);

        if (blockerTaskIds.length) {
          await orgPool.query(
            `UPDATE standup_entries SET blocker_task_ids = $2::uuid[] WHERE id = $1`,
            [String(standup.id), blockerTaskIds]
          );
        }
      }

      await orgPool.query('COMMIT');
      return {
        ...standup,
        blockerTaskIds,
      };
    } catch (err) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async list(req, { sprintId, entryDate }) {
    const orgPool = requireOrgDb(req);
    const { developerId } = await getActorMemberAndDeveloper(orgPool, req.user?.userId);

    const dateIso = entryDate ? toIsoDate(entryDate) : null;
    if (entryDate && !dateIso) throw Object.assign(new Error('Invalid entryDate'), { statusCode: 400 });

    const resolvedSprint = await resolveSprintId(orgPool, sprintId);

    const resp = await orgPool.query(
      `SELECT * FROM standup_entries
       WHERE sprint_id = $1
         AND developer_id = $2
         AND ($3::date IS NULL OR entry_date = $3::date)
       ORDER BY entry_date DESC
       LIMIT 30`,
      [String(resolvedSprint.sprintId), String(developerId), dateIso]
    );

    return resp.rows;
  }
}

const standupService = new StandupService();

module.exports = {
  standupService,
};
