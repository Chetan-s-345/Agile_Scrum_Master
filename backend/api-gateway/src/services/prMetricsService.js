const { db } = require('../config/database');

function safeText(value) {
  return String(value || '').trim();
}

function parseDate(value) {
  const ts = new Date(value || '').getTime();
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function minutesExpr(startCol, endCol) {
  return `CASE WHEN ${startCol} IS NOT NULL AND ${endCol} IS NOT NULL THEN EXTRACT(EPOCH FROM (${endCol} - ${startCol})) / 60.0 ELSE NULL END`;
}

function startOfWeekUtc(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function previousWeekRange(now) {
  const thisWeekStart = startOfWeekUtc(now);
  const prevWeekStart = new Date(thisWeekStart);
  prevWeekStart.setUTCDate(prevWeekStart.getUTCDate() - 7);
  return { weekStart: prevWeekStart, weekEnd: thisWeekStart };
}

async function findDeveloperIdByUsername(orgPool, username) {
  const login = safeText(username);
  if (!login) return null;

  const resp = await orgPool.query(
    `SELECT dp.id
     FROM developer_profiles dp
     JOIN team_members tm ON tm.id = dp.member_id
     WHERE LOWER(tm.github_username) = LOWER($1)
     LIMIT 1`,
    [login]
  );

  return resp.rows[0]?.id || null;
}

async function recomputeMeritFromReviewSpeed(orgPool, reviewer) {
  const login = safeText(reviewer);
  if (!login) return;

  const developerId = await findDeveloperIdByUsername(orgPool, login);
  if (!developerId) return;

  const resp = await orgPool.query(
    `SELECT AVG(${minutesExpr('review_requested_at', 'first_review_at')}) AS avg_minutes
     FROM github_pr_events
     WHERE reviewer = $1
       AND review_requested_at IS NOT NULL
       AND first_review_at IS NOT NULL
       AND review_requested_at >= NOW() - INTERVAL '90 days'`,
    [login]
  );

  const avgMinutes = Number(resp.rows[0]?.avg_minutes || 0);
  if (!Number.isFinite(avgMinutes) || avgMinutes <= 0) return;

  const avgHours = avgMinutes / 60;
  const prSpeedScore = Math.min(100, (100 / avgHours) * 8);

  await orgPool.query(
    `UPDATE developer_profiles
     SET avg_pr_review_hours = ROUND($2::numeric, 2),
         merit_score = ROUND(((merit_score * 0.85) + ($3 * 0.15))::numeric, 2),
         merit_score_updated_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [String(developerId), avgHours, prSpeedScore]
  );
}

async function upsertPrEvent(orgPool, payload, taskId, sprintId, overrides) {
  const pr = payload?.pull_request || {};
  const number = Number(pr.number || payload?.number || overrides?.prNumber || 0);
  const repo = safeText(payload?.repository?.full_name || payload?.repository?.name || overrides?.repo);

  if (!Number.isFinite(number) || number <= 0 || !repo) return null;

  const author = safeText(pr?.user?.login || overrides?.author) || null;
  const reviewer = safeText(overrides?.reviewer) || null;

  const openedAt = parseDate(pr?.created_at || overrides?.openedAt);
  const reviewRequestedAt = parseDate(overrides?.reviewRequestedAt);
  const firstReviewAt = parseDate(overrides?.firstReviewAt);
  const approvedAt = parseDate(overrides?.approvedAt);
  const mergedAt = parseDate(pr?.merged_at || overrides?.mergedAt);

  const resp = await orgPool.query(
    `INSERT INTO github_pr_events (
       pr_number, repo, author, reviewer,
       opened_at, review_requested_at, first_review_at, approved_at, merged_at,
       sprint_id, task_id, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (repo, pr_number) DO UPDATE SET
       author = COALESCE(EXCLUDED.author, github_pr_events.author),
       reviewer = COALESCE(EXCLUDED.reviewer, github_pr_events.reviewer),
       opened_at = COALESCE(github_pr_events.opened_at, EXCLUDED.opened_at),
       review_requested_at = COALESCE(github_pr_events.review_requested_at, EXCLUDED.review_requested_at),
       first_review_at = COALESCE(github_pr_events.first_review_at, EXCLUDED.first_review_at),
       approved_at = COALESCE(github_pr_events.approved_at, EXCLUDED.approved_at),
       merged_at = COALESCE(github_pr_events.merged_at, EXCLUDED.merged_at),
       sprint_id = COALESCE(EXCLUDED.sprint_id, github_pr_events.sprint_id),
       task_id = COALESCE(EXCLUDED.task_id, github_pr_events.task_id),
       updated_at = NOW()
     RETURNING *`,
    [number, repo, author, reviewer, openedAt, reviewRequestedAt, firstReviewAt, approvedAt, mergedAt, sprintId || null, taskId || null]
  );

  return resp.rows[0] || null;
}

async function recordPullRequestEvent(orgPool, payload, taskInfo) {
  const action = safeText(payload?.action).toLowerCase();
  const reviewer = safeText(payload?.requested_reviewer?.login) || null;

  const row = await upsertPrEvent(orgPool, payload, taskInfo?.taskId, taskInfo?.sprintId, {
    reviewer,
    reviewRequestedAt: action === 'review_requested' ? new Date() : null,
    mergedAt: action === 'closed' && payload?.pull_request?.merged ? payload?.pull_request?.merged_at || new Date() : null,
  });

  if (action === 'review_requested' && reviewer) {
    await recomputeMeritFromReviewSpeed(orgPool, reviewer);
  }

  return row;
}

async function recordPullRequestReviewEvent(orgPool, payload, taskInfo) {
  const review = payload?.review || {};
  const reviewer = safeText(review?.user?.login || payload?.sender?.login) || null;
  const submittedAt = review?.submitted_at || new Date();
  const state = safeText(review?.state).toLowerCase();

  const row = await upsertPrEvent(orgPool, payload, taskInfo?.taskId, taskInfo?.sprintId, {
    reviewer,
    firstReviewAt: submittedAt,
    approvedAt: state === 'approved' ? submittedAt : null,
  });

  if (reviewer) await recomputeMeritFromReviewSpeed(orgPool, reviewer);
  return row;
}

async function getPrReviewMetrics(orgPool, options) {
  const groupBy = safeText(options?.groupBy).toLowerCase();
  const sprintId = safeText(options?.sprintId);

  if (groupBy === 'reviewer') {
    const resp = await orgPool.query(
      `SELECT
         reviewer AS key,
         ROUND(AVG(${minutesExpr('review_requested_at', 'first_review_at')})::numeric, 2) AS time_to_first_review,
         ROUND(AVG(${minutesExpr('first_review_at', 'approved_at')})::numeric, 2) AS time_to_approval,
         ROUND(AVG(${minutesExpr('approved_at', 'merged_at')})::numeric, 2) AS time_to_merge,
         COUNT(*)::int AS sample_size
       FROM github_pr_events
       WHERE reviewer IS NOT NULL
       GROUP BY reviewer
       ORDER BY reviewer ASC`
    );
    return resp.rows;
  }

  if (groupBy === 'project') {
    const resp = await orgPool.query(
      `SELECT
         COALESCE(p.name, p.jira_project_key, 'unknown') AS key,
         ROUND(AVG(${minutesExpr('gpe.review_requested_at', 'gpe.first_review_at')})::numeric, 2) AS time_to_first_review,
         ROUND(AVG(${minutesExpr('gpe.first_review_at', 'gpe.approved_at')})::numeric, 2) AS time_to_approval,
         ROUND(AVG(${minutesExpr('gpe.approved_at', 'gpe.merged_at')})::numeric, 2) AS time_to_merge,
         COUNT(*)::int AS sample_size
       FROM github_pr_events gpe
       LEFT JOIN tasks t ON t.id = gpe.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       GROUP BY COALESCE(p.name, p.jira_project_key, 'unknown')
       ORDER BY key ASC`
    );
    return resp.rows;
  }

  if (groupBy === 'sprint') {
    if (!sprintId) throw Object.assign(new Error('sprintId is required for groupBy=sprint'), { statusCode: 400 });

    const resp = await orgPool.query(
      `SELECT
         $1::text AS key,
         ROUND(AVG(${minutesExpr('review_requested_at', 'first_review_at')})::numeric, 2) AS time_to_first_review,
         ROUND(AVG(${minutesExpr('first_review_at', 'approved_at')})::numeric, 2) AS time_to_approval,
         ROUND(AVG(${minutesExpr('approved_at', 'merged_at')})::numeric, 2) AS time_to_merge,
         COUNT(*)::int AS sample_size
       FROM github_pr_events
       WHERE sprint_id = $1`,
      [sprintId]
    );

    return resp.rows;
  }

  throw Object.assign(new Error('groupBy must be reviewer, project, or sprint'), { statusCode: 400 });
}

async function storeWeeklyByGroup(orgPool, weekStart, weekEnd, groupBy, query) {
  const resp = await orgPool.query(query, [weekStart, weekEnd]);

  for (const row of resp.rows) {
    await orgPool.query(
      `INSERT INTO pr_review_weekly_summary (
         week_start, week_end, group_by, group_key,
         avg_time_to_first_review_minutes,
         avg_time_to_approval_minutes,
         avg_time_to_merge_minutes,
         sample_size,
         updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (week_start, week_end, group_by, group_key) DO UPDATE SET
         avg_time_to_first_review_minutes = EXCLUDED.avg_time_to_first_review_minutes,
         avg_time_to_approval_minutes = EXCLUDED.avg_time_to_approval_minutes,
         avg_time_to_merge_minutes = EXCLUDED.avg_time_to_merge_minutes,
         sample_size = EXCLUDED.sample_size,
         updated_at = NOW()`,
      [
        weekStart,
        weekEnd,
        groupBy,
        String(row.key || 'unknown'),
        row.time_to_first_review,
        row.time_to_approval,
        row.time_to_merge,
        Number(row.sample_size || 0),
      ]
    );
  }

  return resp.rows.length;
}

async function computeWeeklySummaryForOrg(orgPool, now) {
  const { weekStart, weekEnd } = previousWeekRange(now || new Date());

  const reviewerCount = await storeWeeklyByGroup(
    orgPool,
    weekStart,
    weekEnd,
    'reviewer',
    `SELECT
       reviewer AS key,
       ROUND(AVG(${minutesExpr('review_requested_at', 'first_review_at')})::numeric, 2) AS time_to_first_review,
       ROUND(AVG(${minutesExpr('first_review_at', 'approved_at')})::numeric, 2) AS time_to_approval,
       ROUND(AVG(${minutesExpr('approved_at', 'merged_at')})::numeric, 2) AS time_to_merge,
       COUNT(*)::int AS sample_size
     FROM github_pr_events
     WHERE opened_at >= $1
       AND opened_at < $2
       AND reviewer IS NOT NULL
     GROUP BY reviewer`
  );

  const projectCount = await storeWeeklyByGroup(
    orgPool,
    weekStart,
    weekEnd,
    'project',
    `SELECT
       COALESCE(p.name, p.jira_project_key, 'unknown') AS key,
       ROUND(AVG(${minutesExpr('gpe.review_requested_at', 'gpe.first_review_at')})::numeric, 2) AS time_to_first_review,
       ROUND(AVG(${minutesExpr('gpe.first_review_at', 'gpe.approved_at')})::numeric, 2) AS time_to_approval,
       ROUND(AVG(${minutesExpr('gpe.approved_at', 'gpe.merged_at')})::numeric, 2) AS time_to_merge,
       COUNT(*)::int AS sample_size
     FROM github_pr_events gpe
     LEFT JOIN tasks t ON t.id = gpe.task_id
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE gpe.opened_at >= $1
       AND gpe.opened_at < $2
     GROUP BY COALESCE(p.name, p.jira_project_key, 'unknown')`
  );

  const sprintCount = await storeWeeklyByGroup(
    orgPool,
    weekStart,
    weekEnd,
    'sprint',
    `SELECT
       COALESCE(gpe.sprint_id::text, 'unknown') AS key,
       ROUND(AVG(${minutesExpr('review_requested_at', 'first_review_at')})::numeric, 2) AS time_to_first_review,
       ROUND(AVG(${minutesExpr('first_review_at', 'approved_at')})::numeric, 2) AS time_to_approval,
       ROUND(AVG(${minutesExpr('approved_at', 'merged_at')})::numeric, 2) AS time_to_merge,
       COUNT(*)::int AS sample_size
     FROM github_pr_events gpe
     WHERE gpe.opened_at >= $1
       AND gpe.opened_at < $2
     GROUP BY COALESCE(gpe.sprint_id::text, 'unknown')`
  );

  return { weekStart, weekEnd, reviewerCount, projectCount, sprintCount };
}

async function listOrgIdsWithTenantDb() {
  const hasColumn = await db._orgHasColumn('db_connection_string');
  if (!hasColumn) return [];

  const resp = await db.universalPool.query(
    `SELECT id
     FROM organizations
     WHERE db_connection_string IS NOT NULL
       AND LENGTH(TRIM(db_connection_string)) > 0`
  );

  return resp.rows.map((r) => String(r.id));
}

async function computeWeeklySummaryForAllOrgs(now) {
  const orgIds = await listOrgIdsWithTenantDb();
  const out = [];

  for (const orgId of orgIds) {
    const pool = await db.getOrgPool(String(orgId));
    const result = await computeWeeklySummaryForOrg(pool, now || new Date());
    out.push({ orgId, ...result });
  }

  return out;
}

class PrMetricsService {
  async recordPullRequestEvent(orgPool, payload, taskInfo) {
    return recordPullRequestEvent(orgPool, payload, taskInfo);
  }

  async recordPullRequestReviewEvent(orgPool, payload, taskInfo) {
    return recordPullRequestReviewEvent(orgPool, payload, taskInfo);
  }

  async getPrReviewMetrics(orgPool, options) {
    return getPrReviewMetrics(orgPool, options);
  }

  async computeWeeklySummaryForOrg(orgPool, now) {
    return computeWeeklySummaryForOrg(orgPool, now);
  }

  async computeWeeklySummaryForAllOrgs(now) {
    return computeWeeklySummaryForAllOrgs(now);
  }
}

const prMetricsService = new PrMetricsService();

module.exports = {
  PrMetricsService,
  prMetricsService,
};
