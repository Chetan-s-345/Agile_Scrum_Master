const { db } = require('../config/database');
const { meetingsService } = require('./meetings.service');

function getSprintDurationDays(sprint) {
  if (Number.isFinite(Number(sprint?.durationDays)) && Number(sprint.durationDays) > 0) {
    return Number(sprint.durationDays);
  }

  const start = new Date(String(sprint?.startDate || sprint?.start_date || ''));
  const end = new Date(String(sprint?.endDate || sprint?.end_date || ''));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 14;

  const diff = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return Math.max(1, diff);
}

function getSprintStartDate(sprint) {
  const raw = sprint?.startDate || sprint?.start_date;
  const parsed = new Date(String(raw || ''));
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error('Sprint start date is required to schedule meetings'), {
      statusCode: 400,
      code: 'SPRINT_START_DATE_REQUIRED',
    });
  }
  return parsed;
}

async function hasExistingMeeting(orgPool, sprintId, type, scheduledStartIso) {
  const response = await orgPool.query(
    `SELECT id
     FROM meeting_sessions
     WHERE sprint_id = $1
       AND meeting_type = $2
       AND DATE(scheduled_start) = DATE($3)
     LIMIT 1`,
    [String(sprintId), String(type), String(scheduledStartIso)]
  );

  return Boolean(response.rows[0]?.id);
}

async function scheduleSprintMeetings(orgId, sprint) {
  const orgPool = await db.getOrgPool(String(orgId));
  const durationDays = getSprintDurationDays(sprint);
  const sprintStart = getSprintStartDate(sprint);

  const meetings = [
    { type: 'planning', title: 'Sprint planning', offset: 0 },
    { type: 'daily', title: 'Daily standup', offset: 1, repeat: 'daily' },
    { type: 'review', title: 'Sprint review', offset: durationDays - 1 },
    { type: 'retro', title: 'Retrospective', offset: durationDays - 1, startHour: 14 },
  ];

  const created = [];

  for (const m of meetings) {
    const iterationCount = m.repeat === 'daily' ? Math.max(0, durationDays - m.offset) : 1;
    for (let repeatIndex = 0; repeatIndex < iterationCount; repeatIndex += 1) {
      const offset = m.offset + repeatIndex;
      const scheduledStart = new Date(sprintStart);
      scheduledStart.setDate(scheduledStart.getDate() + offset);
      scheduledStart.setHours(m.startHour || 9, 0, 0, 0);

      const scheduledStartIso = scheduledStart.toISOString();
      const exists = await hasExistingMeeting(orgPool, sprint.id, m.type, scheduledStartIso);
      if (exists) continue;

      const item = await meetingsService.createForOrg(orgId, {
        type: m.type,
        title: m.title,
        sprintId: sprint.id,
        projectId: sprint.project_id || sprint.projectId || null,
        scheduledStart: scheduledStartIso,
        createJoinUrl: true,
        provider: 'daily',
      });
      created.push(item);
    }
  }

  return {
    sprintId: String(sprint.id),
    createdCount: created.length,
    items: created,
  };
}

module.exports = {
  scheduleSprintMeetings,
};
