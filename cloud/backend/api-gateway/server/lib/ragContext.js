const { searchSimilar } = require('./embeddings');

function safe(value) {
  return String(value || '').trim();
}

function toIso(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function normalizeType(sourceType) {
  const raw = safe(sourceType);
  return raw ? raw.toUpperCase() : 'UNKNOWN';
}

function formatRagText(results) {
  if (!Array.isArray(results) || !results.length) return '';
  return results
    .map((r) => `[${normalizeType(r.sourceType)}] ${safe(r.content)}`)
    .filter(Boolean)
    .join('\n---\n');
}

function formatSprintTasks(tasks) {
  if (!tasks.length) return '  (no tasks in active sprint)';
  return tasks
    .map((t) => {
      const code = safe(t.code || t.id || 'TASK');
      const title = safe(t.title || 'Untitled task');
      const status = safe(t.status || 'unknown');
      const assignee = safe(t.assignee_name || 'Unassigned');
      return `  ${code} - ${title} [${status}] -> ${assignee}`;
    })
    .join('\n');
}

function formatWorkload(developers) {
  if (!developers.length) return '  (no developers found)';
  return developers
    .map((d) => {
      const name = safe(d.full_name || 'Unknown');
      const taskCount = Number(d.active_task_count || 0);
      const skills = Array.isArray(d.tech_stack) ? d.tech_stack.join(', ') : '';
      return `  ${name}: ${taskCount} tasks | skills: ${skills || 'n/a'}`;
    })
    .join('\n');
}

async function getActiveSprint(orgPool, projectId) {
  const sprintResp = await orgPool.query(
    `SELECT id, name, goal, start_date, end_date, status
     FROM sprints
     WHERE project_id = $1
       AND status = 'active'
     ORDER BY start_date DESC
     LIMIT 1`,
    [String(projectId)]
  );
  const sprint = sprintResp.rows[0] || null;
  if (!sprint) return { sprint: null, tasks: [], doneCount: 0, totalCount: 0 };

  const tasksResp = await orgPool.query(
    `SELECT
       t.id,
       t.title,
       t.status,
       tm.full_name AS assignee_name
     FROM tasks t
     LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
     LEFT JOIN team_members tm ON tm.id = dp.member_id
     WHERE t.sprint_id = $1
     ORDER BY t.updated_at DESC`,
    [String(sprint.id)]
  );
  const tasks = tasksResp.rows;
  const doneCount = tasks.filter((t) => safe(t.status) === 'done').length;
  return { sprint, tasks, doneCount, totalCount: tasks.length };
}

async function getRecentTasks(orgPool, projectId) {
  const resp = await orgPool.query(
    `SELECT
       t.id,
       t.title,
       t.status,
       tm.full_name AS assignee_name,
       t.updated_at
     FROM tasks t
     LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
     LEFT JOIN team_members tm ON tm.id = dp.member_id
     WHERE t.project_id = $1
     ORDER BY t.updated_at DESC
     LIMIT 15`,
    [String(projectId)]
  );
  return resp.rows;
}

async function getDevelopersWorkload(orgPool, projectId) {
  const resp = await orgPool.query(
    `SELECT
       dp.id,
       tm.full_name,
       dp.tech_stack,
       COUNT(t.id)::int AS active_task_count
     FROM developer_profiles dp
     JOIN team_members tm ON tm.id = dp.member_id
     LEFT JOIN tasks t
       ON t.assignee_id = dp.id
      AND t.project_id = $1
      AND t.status NOT IN ('done', 'cancelled')
     WHERE tm.is_active = TRUE
     GROUP BY dp.id, tm.full_name, dp.tech_stack
     ORDER BY tm.full_name ASC`,
    [String(projectId)]
  );
  return resp.rows;
}

async function getVelocitySnapshot(orgPool, projectId) {
  const resp = await orgPool.query(
    `SELECT id, name, completed_points, actual_velocity, end_date
     FROM sprints
     WHERE project_id = $1
       AND status = 'completed'
     ORDER BY end_date DESC NULLS LAST
     LIMIT 5`,
    [String(projectId)]
  );

  const rows = resp.rows;
  const avg = rows.length
    ? rows.reduce((acc, s) => acc + Number(s.completed_points || 0), 0) / rows.length
    : 0;

  return { sprints: rows, avgStoryPoints: Math.round(avg * 100) / 100 };
}

function formatLiveText({ active, recentTasks, developers, velocity }) {
  const activeLine = active.sprint
    ? `ACTIVE SPRINT: ${safe(active.sprint.name)} | Goal: ${safe(active.sprint.goal)} | ${active.doneCount}/${active.totalCount} done`
    : 'ACTIVE SPRINT: none';

  const recentTaskLines = recentTasks.length
    ? recentTasks
        .map((t) => {
          const code = safe(t.code || t.id || 'TASK');
          return `  ${code} - ${safe(t.title)} [${safe(t.status)}] -> ${safe(t.assignee_name || 'Unassigned')}`;
        })
        .join('\n')
    : '  (no recent tasks)';

  const completedLines = velocity.sprints.length
    ? velocity.sprints
        .map((s) => `  ${safe(s.name)} (${toIso(s.end_date)}): ${Number(s.completed_points || 0)} pts`)
        .join('\n')
    : '  (no completed sprints)';

  return [
    activeLine,
    'TASKS IN SPRINT:',
    formatSprintTasks(active.tasks),
    'LAST 15 UPDATED TASKS:',
    recentTaskLines,
    'TEAM WORKLOAD:',
    formatWorkload(developers),
    `RECENT VELOCITY: ${velocity.avgStoryPoints} story points per sprint`,
    'LAST 5 COMPLETED SPRINTS:',
    completedLines,
  ].join('\n');
}

async function buildContext(query, projectId, orgPool) {
  const results = await searchSimilar({ query: safe(query), projectId: String(projectId), limit: 10 });
  const ragText = formatRagText(results);

  const [active, recentTasks, developers, velocity] = await Promise.all([
    getActiveSprint(orgPool, projectId),
    getRecentTasks(orgPool, projectId),
    getDevelopersWorkload(orgPool, projectId),
    getVelocitySnapshot(orgPool, projectId),
  ]);

  const liveText = formatLiveText({ active, recentTasks, developers, velocity });
  return { ragText, liveText, totalChunks: Array.isArray(results) ? results.length : 0 };
}

module.exports = { buildContext };
