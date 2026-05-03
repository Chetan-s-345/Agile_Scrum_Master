const { getQueues } = require('../services/queue.service');
const { db } = require('../config/database');
const { logger } = require('../middleware/logger');
const { sendTaskAssignmentEmail } = require('../services/email.service');
const { sendInngestEvent } = require('../services/inngestEvent.service');

function parseClaudeJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return { tasks: [] };

  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]);
    }
  }

  return { tasks: [] };
}

function normalizePriority(value) {
  const p = String(value || '').toLowerCase();
  if (p === 'critical' || p === 'high' || p === 'medium' || p === 'low') return p;
  return 'medium';
}

function normalizeStoryPoints(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.min(Math.round(num), 13));
}

function buildClaudePrompt(context) {
  return [
    'You are a Scrum Master AI. Given these meeting notes and the current sprint backlog, identify action items and assign each to the most appropriate team member based on their role and current workload.',
    'Return JSON only: { tasks: [{ title, description, assignee_id, priority, story_points }] }',
    '',
    `Meeting notes:\n${context.notes}`,
    '',
    `Backlog:\n${JSON.stringify(context.backlog, null, 2)}`,
    '',
    `Team members:\n${JSON.stringify(context.teamMembers, null, 2)}`,
  ].join('\n');
}

async function callClaudeAssignments(context) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return { tasks: [] };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1200,
      temperature: 0.1,
      messages: [{ role: 'user', content: buildClaudePrompt(context) }],
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => 'Claude call failed');
    throw Object.assign(new Error('Claude call failed'), {
      statusCode: 502,
      code: 'CLAUDE_REQUEST_FAILED',
      detail: err,
    });
  }

  const payload = await response.json();
  const text = Array.isArray(payload?.content)
    ? payload.content.map((entry) => String(entry?.text || '')).join('\n')
    : '';

  return parseClaudeJson(text);
}

function fallbackTasks(context) {
  const firstMember = context.teamMembers[0];
  if (!firstMember) return [];

  const lines = String(context.notes || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);

  return lines.map((line, index) => ({
    title: line.slice(0, 120),
    description: line,
    assignee_id: firstMember.developerId,
    priority: 'medium',
    story_points: index === 0 ? 3 : 1,
  }));
}

async function loadMeetingContext(orgPool, meetingId) {
  const meetingResp = await orgPool.query(
    `SELECT id, sprint_id, project_id, title, meeting_type, created_by
     FROM meeting_sessions
     WHERE id = $1
     LIMIT 1`,
    [String(meetingId)]
  );

  const meeting = meetingResp.rows[0];
  if (!meeting) {
    throw Object.assign(new Error('Meeting not found for post-meeting processing'), {
      statusCode: 404,
      code: 'MEETING_NOT_FOUND',
    });
  }

  const [notesResp, transcriptResp, backlogResp, membersResp] = await Promise.all([
    orgPool.query(`SELECT content FROM meeting_notes WHERE meeting_id = $1 ORDER BY created_at DESC LIMIT 100`, [String(meetingId)]),
    orgPool.query(
      `SELECT transcript_text
       FROM meeting_transcripts
       WHERE meeting_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [String(meetingId)]
    ),
    orgPool.query(
      `SELECT id, title, description, priority, status, story_points, tech_tags
       FROM backlog_items
       WHERE sprint_id = $1
       ORDER BY created_at DESC
       LIMIT 200`,
      [String(meeting.sprint_id)]
    ),
    orgPool.query(
      `SELECT dp.id AS developer_id,
              tm.full_name,
              tm.email,
              tm.role,
              dp.current_sprint_load,
              dp.max_sprint_capacity,
              dp.tech_stack
       FROM developer_profiles dp
       JOIN team_members tm ON tm.id = dp.member_id
       WHERE tm.is_active = TRUE
       ORDER BY dp.current_sprint_load ASC, tm.full_name ASC`
    ),
  ]);

  const notes = [
    ...notesResp.rows.map((row) => String(row.content || '').trim()),
    String(transcriptResp.rows[0]?.transcript_text || '').trim(),
  ]
    .filter(Boolean)
    .join('\n\n');

  const teamMembers = membersResp.rows.map((row) => ({
    developerId: String(row.developer_id),
    name: String(row.full_name || 'Developer'),
    email: String(row.email || '').trim().toLowerCase(),
    role: String(row.role || 'member'),
    currentLoad: Number(row.current_sprint_load || 0),
    maxCapacity: Number(row.max_sprint_capacity || 0),
    techStack: Array.isArray(row.tech_stack) ? row.tech_stack : [],
  }));

  return {
    meeting,
    notes,
    backlog: backlogResp.rows,
    teamMembers,
  };
}

function pickAssignee(task, teamMembers) {
  const requested = String(task?.assignee_id || '').trim();
  if (requested && teamMembers.some((member) => member.developerId === requested)) {
    return requested;
  }

  return teamMembers[0]?.developerId || null;
}

async function insertAssignedTasks(orgPool, context, candidateTasks) {
  const inserted = [];

  for (const candidate of candidateTasks) {
    const title = String(candidate?.title || '').trim();
    if (!title) continue;

    const assigneeId = pickAssignee(candidate, context.teamMembers);
    if (!assigneeId) continue;

    const insertResp = await orgPool.query(
      `INSERT INTO tasks (
         sprint_id,
         project_id,
         title,
         description,
         type,
         status,
         priority,
         story_points,
         assignee_id,
         assigned_by,
         assigned_at,
         created_by
       ) VALUES ($1,$2,$3,$4,'task','todo',$5,$6,$7,'ai',NOW(),$8)
       RETURNING id, title, description, priority, story_points, assignee_id`,
      [
        String(context.meeting.sprint_id),
        String(context.meeting.project_id),
        title.slice(0, 500),
        String(candidate?.description || '').trim() || null,
        normalizePriority(candidate?.priority),
        normalizeStoryPoints(candidate?.story_points),
        assigneeId,
        String(context.meeting.created_by || ''),
      ]
    );

    const row = insertResp.rows[0];
    inserted.push({
      id: row.id,
      title: row.title,
      description: row.description,
      priority: row.priority,
      storyPoints: Number(row.story_points || 0),
      assigneeId: String(row.assignee_id),
    });

    await orgPool.query(
      `INSERT INTO meeting_action_items (
         meeting_id,
         title,
         detail,
         assignee_developer_id,
         status,
         source
       ) VALUES ($1,$2,$3,$4,'open','ai')`,
      [String(context.meeting.id), row.title, row.description || null, assigneeId]
    );

    await orgPool.query(
      `UPDATE developer_profiles
       SET current_sprint_load = current_sprint_load + $2,
           updated_at = NOW()
       WHERE id = $1`,
      [assigneeId, Number(row.story_points || 0)]
    );
  }

  return inserted;
}

async function notifyAssignees(context, tasks) {
  for (const task of tasks) {
    const assignee = context.teamMembers.find((member) => member.developerId === task.assigneeId);
    if (!assignee?.email) continue;

    await sendTaskAssignmentEmail(
      assignee,
      task,
      {
        sprintId: context.meeting.sprint_id,
        sprintName: null,
      }
    );
  }
}

async function resolveOrgIdForMeeting(meetingId) {
  const orgsResp = await db.universalPool.query(
    `SELECT id, db_connection_string
     FROM organizations
     WHERE db_connection_string IS NOT NULL`
  );

  for (const org of orgsResp.rows || []) {
    try {
      const orgId = String(org.id);
      const orgPool = await db.getOrgPool(orgId);
      const foundResp = await orgPool.query(
        `SELECT id
         FROM meeting_sessions
         WHERE id = $1
         LIMIT 1`,
        [String(meetingId)]
      );
      if (foundResp.rows.length) return orgId;
    } catch {
      // Best-effort lookup across orgs.
    }
  }

  return null;
}

async function processPostMeetingJob({ orgId, meetingId }) {
  const resolvedOrgId = String(orgId || '').trim() || (await resolveOrgIdForMeeting(meetingId));
  if (!resolvedOrgId) {
    throw Object.assign(new Error('Unable to resolve org for post-meeting job'), {
      statusCode: 404,
      code: 'ORG_FOR_MEETING_NOT_FOUND',
    });
  }

  const orgPool = await db.getOrgPool(String(resolvedOrgId));
  const context = await loadMeetingContext(orgPool, meetingId);

  try {
    await sendInngestEvent('meeting/automation.started', {
      orgId: resolvedOrgId,
      meetingId: String(meetingId),
      sprintId: String(context.meeting?.sprint_id || ''),
      projectId: String(context.meeting?.project_id || ''),
      source: 'post-meeting-job',
    });
  } catch {
    // Event dispatch is best-effort.
  }

  let aiTasks = [];
  try {
    const aiResult = await callClaudeAssignments(context);
    aiTasks = Array.isArray(aiResult?.tasks) ? aiResult.tasks : [];
  } catch (err) {
    logger.warn({ err, orgId, meetingId }, 'Claude assignment failed; using fallback task extraction');
  }

  if (!aiTasks.length) aiTasks = fallbackTasks(context);
  if (!aiTasks.length) {
    try {
      await sendInngestEvent('meeting/automation.completed', {
        orgId: resolvedOrgId,
        meetingId: String(meetingId),
        sprintId: String(context.meeting?.sprint_id || ''),
        projectId: String(context.meeting?.project_id || ''),
        createdTaskCount: 0,
      });
    } catch {
      // ignore
    }
    return { created: 0, tasks: [] };
  }

  const createdTasks = await insertAssignedTasks(orgPool, context, aiTasks);
  await notifyAssignees(context, createdTasks);

  for (const task of createdTasks) {
    try {
      await sendInngestEvent('meeting/task.created', {
        orgId: resolvedOrgId,
        projectId: String(context.meeting?.project_id || ''),
        sprintId: String(context.meeting?.sprint_id || ''),
        meetingId: String(meetingId),
        taskId: String(task.id),
        title: String(task.title || ''),
        assigneeId: String(task.assigneeId || ''),
        priority: String(task.priority || 'medium'),
        storyPoints: Number(task.storyPoints || 0),
      });
    } catch {
      // ignore
    }
  }

  await orgPool.query(
    `UPDATE meeting_sessions
     SET ai_action_items = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [String(meetingId), createdTasks.map((task) => ({ id: task.id, title: task.title, status: 'open' }))]
  );

  try {
    await sendInngestEvent('meeting/automation.completed', {
      orgId: resolvedOrgId,
      meetingId: String(meetingId),
      sprintId: String(context.meeting?.sprint_id || ''),
      projectId: String(context.meeting?.project_id || ''),
      createdTaskCount: createdTasks.length,
    });
  } catch {
    // ignore
  }

  return { created: createdTasks.length, tasks: createdTasks };
}

async function enqueuePostMeetingJob({ orgId, meetingId, source = 'unknown' }) {
  const queues = getQueues();
  const normalizedOrgId = String(orgId || '').trim();
  const jobId = `post-meeting:${normalizedOrgId || 'unknown'}:${meetingId}`;

  await queues.postMeeting.add(
    'assign-post-meeting-tasks',
    {
      orgId: normalizedOrgId || null,
      meetingId: String(meetingId),
      source: String(source),
    },
    {
      jobId,
      removeOnComplete: true,
      removeOnFail: 250,
      attempts: 4,
      backoff: { type: 'exponential', delay: 3000 },
    }
  );

  return { queued: true, jobId };
}

module.exports = {
  enqueuePostMeetingJob,
  processPostMeetingJob,
};
