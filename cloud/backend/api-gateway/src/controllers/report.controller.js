function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPct(numerator, denominator) {
  if (!denominator || Number(denominator) <= 0) return null;
  return Math.round((Number(numerator || 0) / Number(denominator)) * 1000) / 10;
}

function dateOnly(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function csvEscape(value) {
  const source = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(source)) return `"${source.replace(/"/g, '""')}"`;
  return source;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function summarizeRiskLevel(score) {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

function statusFromScore(score) {
  if (score >= 75) return 'Healthy';
  if (score >= 45) return 'Needs Attention';
  return 'Critical';
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function daysDiff(startValue, endValue) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
}

function priorityWeight(priority) {
  const p = String(priority || '').toLowerCase();
  if (p === 'critical') return 1.0;
  if (p === 'high') return 0.8;
  if (p === 'medium') return 0.5;
  return 0.3;
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
}

function tokenizeText(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((w) => w.length > 3);
}

function getGroqModels() {
  const configured = String(process.env.GROQ_MODEL || '').trim();
  const candidates = [configured, 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768'].filter(Boolean);
  return Array.from(new Set(candidates));
}

function stripCodeFences(value) {
  return String(value || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

async function callGroqAuditInsights(prompt) {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) return null;

  const baseUrl = String(process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const models = getGroqModels();
  let lastDetail = 'Groq request failed';

  for (const model of models) {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          { role: 'system', content: 'You are a senior Scrum Master and engineering manager. Return strict JSON only.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    const payload = await resp.json().catch(() => null);
    if (resp.ok) {
      const content = stripCodeFences(payload?.choices?.[0]?.message?.content || '');
      if (!content) {
        lastDetail = 'Groq returned an empty response.';
        continue;
      }

      try {
        return JSON.parse(content);
      } catch {
        return { executive_summary: content };
      }
    }

    const detail = String(payload?.error?.message || payload?.message || `Groq request failed with ${resp.status}`);
    lastDetail = detail;
    const shouldTryNextModel = /model|not found|invalid|unsupported/i.test(detail);
    if (!shouldTryNextModel) {
      throw Object.assign(new Error(detail), { statusCode: resp.status || 502, code: 'GROQ_AUDIT_FAILED', detail });
    }
  }

  throw Object.assign(new Error(lastDetail), {
    statusCode: 502,
    code: 'GROQ_AUDIT_FAILED',
    detail: lastDetail,
  });
}

function buildAuditPrompt({ sprint, backlog, skillGap, overloadedDevelopers, underutilisedDevelopers, taskMismatch, recommendations }) {
  const payload = {
    sprint,
    backlog,
    skill_gap: skillGap,
    overloaded_developers: overloadedDevelopers,
    underutilised_developers: underutilisedDevelopers,
    task_mismatch: taskMismatch,
    current_recommendations: recommendations,
  };

  return [
    'Create sprint audit recommendations in JSON.',
    'Return this shape only:',
    '{"executive_summary":"string","priority_actions":["string"],"skills_focus":[{"skill":"string","reason":"string","target_developers":["string"],"recommended_actions":["string"]}],"bench_developer_actions":[{"developer":"string","current_load":0,"focus":"string","next_steps":["string"]}],"notes":["string"]}',
    'Use the following audit data and make the recommendations concrete, concise, and actionable:',
    JSON.stringify(payload),
  ].join('\n');
}

function buildFallbackAuditInsights({ sprintName, skillGap, overloadedDevelopers, underutilisedDevelopers, taskMismatch, recommendations }) {
  const skillFocus = skillGap.length
    ? skillGap.slice(0, 5).map((skill) => ({
        skill,
        reason: `The sprint backlog includes ${skill} work that is not covered by the current team skill mix.`,
        target_developers: underutilisedDevelopers.slice(0, 2).map((dev) => dev.name),
        recommended_actions: [
          `Pair one underutilised developer with tasks tagged ${skill}.`,
          `Run a short enablement session on ${skill} before the next sprint planning cycle.`,
        ],
      }))
    : [];

  const benchActions = underutilisedDevelopers.slice(0, 4).map((dev) => ({
    developer: dev.name,
    current_load: dev.assigned_story_points,
    focus: dev.capacity > 0 && dev.assigned_story_points === 0 ? 'Bench capacity available for skill growth or stretch work.' : 'Low load contributor who can absorb targeted work.',
    next_steps: [
      'Assign a low-risk backlog item tied to an in-demand skill.',
      'Pair with the owning developer for the first implementation slice.',
    ],
  }));

  return {
    executive_summary: `Sprint ${sprintName} needs workload balancing and targeted skill growth.`,
    priority_actions: recommendations.top_3_immediate_actions || [],
    skills_focus: skillFocus,
    bench_developer_actions: benchActions,
    notes: [
      `${overloadedDevelopers.length} developers are overloaded.`,
      `${underutilisedDevelopers.length} developers have room to take on targeted growth work.`,
      `${taskMismatch.length} tasks currently exceed the assignee's declared skills.`,
    ],
  };
}

async function tableExists(orgPool, tableName) {
  const resp = await orgPool.query(`SELECT to_regclass($1) AS name`, [String(tableName)]);
  return Boolean(resp.rows[0]?.name);
}

function parseGithubAccessToken(rawValue) {
  if (!rawValue) return '';
  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    const token = String(parsed?.accessToken || '').trim();
    if (token) return token;
  } catch {
    // fall through
  }
  return String(rawValue || '').trim();
}

async function fetchGithubFallbackForSprint(orgPool, sprint) {
  const integrationResp = await orgPool.query(
    `SELECT github_org, repo_name, access_token_enc
     FROM github_integration
     WHERE is_active = TRUE
     ORDER BY created_at ASC
     LIMIT 1`
  );

  const integration = integrationResp.rows[0] || null;
  if (!integration) return null;

  const owner = String(integration.github_org || '').trim();
  const repo = String(integration.repo_name || '').trim();
  const accessToken = parseGithubAccessToken(integration.access_token_enc);
  if (!owner || !repo || !accessToken) return null;

  const since = new Date(sprint.start_date).toISOString();
  const untilDate = new Date(sprint.end_date);
  untilDate.setDate(untilDate.getDate() + 1);
  const until = untilDate.toISOString();

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'agile-scrum-master-report-fallback',
  };

  const [commitsResp, prsResp, issuesResp] = await Promise.all([
    fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=100`, { headers }),
    fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=100`, { headers }),
    fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100`, { headers }),
  ]);

  if (!commitsResp.ok && !prsResp.ok && !issuesResp.ok) return null;

  const commits = commitsResp.ok ? await commitsResp.json().catch(() => []) : [];
  const pullsRaw = prsResp.ok ? await prsResp.json().catch(() => []) : [];
  const issuesRaw = issuesResp.ok ? await issuesResp.json().catch(() => []) : [];

  const windowStart = new Date(since).getTime();
  const windowEnd = new Date(until).getTime();

  const pulls = Array.isArray(pullsRaw)
    ? pullsRaw.filter((pr) => {
        const ts = new Date(pr?.merged_at || pr?.updated_at || pr?.created_at || 0).getTime();
        return Number.isFinite(ts) && ts >= windowStart && ts <= windowEnd;
      })
    : [];

  const issues = Array.isArray(issuesRaw)
    ? issuesRaw.filter((issue) => {
        if (issue?.pull_request) return false;
        const ts = new Date(issue?.created_at || issue?.updated_at || 0).getTime();
        return Number.isFinite(ts) && ts >= windowStart && ts <= windowEnd;
      })
    : [];

  const commitsList = Array.isArray(commits) ? commits : [];
  const contributorMap = new Map();

  for (const c of commitsList) {
    const login = String(c?.author?.login || c?.commit?.author?.name || 'Unknown').trim() || 'Unknown';
    const bucket = contributorMap.get(login) || { developer: login, totalEvents: 0, commits: 0, pullRequests: 0, additions: 0, deletions: 0 };
    bucket.totalEvents += 1;
    bucket.commits += 1;
    contributorMap.set(login, bucket);
  }
  for (const pr of pulls) {
    const login = String(pr?.user?.login || 'Unknown').trim() || 'Unknown';
    const bucket = contributorMap.get(login) || { developer: login, totalEvents: 0, commits: 0, pullRequests: 0, additions: 0, deletions: 0 };
    bucket.totalEvents += 1;
    bucket.pullRequests += 1;
    contributorMap.set(login, bucket);
  }

  const recentEvents = [
    ...commitsList.slice(0, 15).map((c) => ({
      id: String(c?.sha || Math.random()),
      type: 'commit',
      repo: `${owner}/${repo}`,
      developer: String(c?.author?.login || c?.commit?.author?.name || 'Unknown'),
      commitSha: c?.sha || null,
      prNumber: null,
      branch: null,
      additions: 0,
      deletions: 0,
      eventAt: c?.commit?.author?.date || c?.commit?.committer?.date || null,
    })),
    ...pulls.slice(0, 15).map((pr) => ({
      id: String(pr?.id || pr?.number || Math.random()),
      type: 'pull_request',
      repo: `${owner}/${repo}`,
      developer: String(pr?.user?.login || 'Unknown'),
      commitSha: null,
      prNumber: Number(pr?.number || 0) || null,
      branch: String(pr?.head?.ref || '') || null,
      additions: Number(pr?.additions || 0),
      deletions: Number(pr?.deletions || 0),
      eventAt: pr?.updated_at || pr?.created_at || null,
    })),
  ]
    .filter((event) => Boolean(event.eventAt))
    .sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime())
    .slice(0, 25);

  const byDeveloper = Array.from(contributorMap.values())
    .sort((a, b) => b.totalEvents - a.totalEvents || b.commits - a.commits)
    .slice(0, 10);

  const lastEventAt = recentEvents[0]?.eventAt || null;

  return {
    summary: {
      commits: commitsList.length,
      pushes: 0,
      pullRequests: pulls.length,
      reviews: 0,
      issues: issues.length,
      contributors: byDeveloper.length,
      repositories: 1,
      additions: pulls.reduce((acc, pr) => acc + Number(pr?.additions || 0), 0),
      deletions: pulls.reduce((acc, pr) => acc + Number(pr?.deletions || 0), 0),
      lastEventAt,
    },
    byDeveloper,
    recentEvents,
  };
}

async function listReports(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const sprintResp = await orgPool.query(
      `SELECT id, name, status, start_date, end_date, planned_points, completed_points
       FROM sprints
       WHERE status IN ('active','completed')
       ORDER BY start_date DESC
       LIMIT 12`
    );

    const fallbackSprintResp = sprintResp.rows && sprintResp.rows.length
      ? { rows: sprintResp.rows }
      : await orgPool.query(
          `SELECT id, name, status, start_date, end_date, planned_points, completed_points
           FROM sprints
           ORDER BY COALESCE(end_date, start_date) DESC, created_at DESC
           LIMIT 12`
        );

    const sprints = fallbackSprintResp.rows || [];
    const sprintIds = sprints.map((s) => String(s.id));

    const [hasSprintPerf, hasDelayAlerts, hasProgressSnapshots, hasMeetingSessions, hasGithubEvents, hasGithubPrEvents] = await Promise.all([
      tableExists(orgPool, 'sprint_performance'),
      tableExists(orgPool, 'delay_alerts'),
      tableExists(orgPool, 'sprint_progress_snapshots'),
      tableExists(orgPool, 'meeting_sessions'),
      tableExists(orgPool, 'github_events'),
      tableExists(orgPool, 'github_pr_events'),
    ]);

    const burnoutResp = sprintIds.length && hasSprintPerf
      ? await orgPool.query(
          `SELECT
             sp.sprint_id,
             COUNT(*) FILTER (WHERE sp.over_capacity = TRUE)::int AS at_risk_count,
             ROUND(AVG(
               CASE
                 WHEN sp.max_capacity_pts > 0
                 THEN ((sp.story_points_assigned - sp.max_capacity_pts)::numeric / sp.max_capacity_pts::numeric) * 100
                 ELSE NULL
               END
             ), 2) AS avg_overload_pct
           FROM sprint_performance sp
           WHERE sp.sprint_id = ANY($1::uuid[])
           GROUP BY sp.sprint_id`,
          [sprintIds]
        )
      : { rows: [] };

    const blockedResp = sprintIds.length
      ? await orgPool.query(
          `SELECT sprint_id, COUNT(*)::int AS blocked_count
           FROM tasks
           WHERE sprint_id = ANY($1::uuid[])
             AND status = 'blocked'
           GROUP BY sprint_id`,
          [sprintIds]
        )
      : { rows: [] };

    const riskResp = sprintIds.length && hasProgressSnapshots
      ? await orgPool.query(
          `SELECT DISTINCT ON (sps.sprint_id)
             sps.sprint_id,
             sps.delay_risk_score
           FROM sprint_progress_snapshots sps
           WHERE sps.sprint_id = ANY($1::uuid[])
           ORDER BY sps.sprint_id, sps.snapshot_date DESC`,
          [sprintIds]
        )
      : { rows: [] };

    const alertResp = sprintIds.length && hasDelayAlerts
      ? await orgPool.query(
          `SELECT sprint_id, severity, COUNT(*)::int AS total
           FROM delay_alerts
           WHERE sprint_id = ANY($1::uuid[])
             AND acknowledged = FALSE
           GROUP BY sprint_id, severity`,
          [sprintIds]
        )
      : { rows: [] };

    const taskStatsResp = sprintIds.length
      ? await orgPool.query(
          `SELECT
             sprint_id,
             COUNT(*)::int AS total_tasks,
             COUNT(*) FILTER (WHERE status = 'todo')::int AS todo_tasks,
             COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_tasks,
             COUNT(*) FILTER (WHERE status = 'in_review')::int AS in_review_tasks,
             COUNT(*) FILTER (WHERE status = 'done')::int AS done_tasks,
             COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked_tasks,
             COALESCE(SUM(story_points), 0)::int AS total_story_points
           FROM tasks
           WHERE sprint_id = ANY($1::uuid[])
           GROUP BY sprint_id`,
          [sprintIds]
        )
      : { rows: [] };

    const githubRawResp = sprintIds.length && hasGithubEvents
      ? await orgPool.query(
          `SELECT
             t.sprint_id,
             COUNT(*) FILTER (WHERE ge.github_commit_sha IS NOT NULL OR ge.event_type IN ('commit'))::int AS commit_count,
             COUNT(*) FILTER (WHERE ge.event_type IN ('push'))::int AS push_count,
             COUNT(*) FILTER (WHERE ge.event_type IN ('pull_request', 'pull_request_opened', 'pull_request_closed', 'pr_opened', 'pr_merged'))::int AS pr_count,
             COUNT(*) FILTER (WHERE ge.event_type IN ('review', 'pull_request_review'))::int AS review_count,
             COUNT(*) FILTER (WHERE ge.event_type IN ('issue', 'issues'))::int AS issue_count,
             COUNT(DISTINCT ge.developer_id)::int AS contributor_count,
             COUNT(DISTINCT ge.repo_name)::int AS repo_count,
             COALESCE(SUM(ge.additions), 0)::int AS additions,
             COALESCE(SUM(ge.deletions), 0)::int AS deletions,
             MAX(ge.event_at) AS last_event_at
           FROM github_events ge
           JOIN tasks t ON t.id = ge.task_id OR t.github_pr_number = ge.github_pr_number
           WHERE t.sprint_id = ANY($1::uuid[])
           GROUP BY t.sprint_id`,
          [sprintIds]
        )
      : { rows: [] };

    const githubPrResp = sprintIds.length && hasGithubPrEvents
      ? await orgPool.query(
          `SELECT
             COALESCE(gpe.sprint_id, t.sprint_id) AS sprint_id,
             COUNT(*)::int AS pr_count,
             COUNT(*) FILTER (WHERE gpe.reviewer IS NOT NULL OR gpe.first_review_at IS NOT NULL)::int AS review_count,
             COUNT(DISTINCT COALESCE(author_tm.full_name, gpe.author, reviewer_tm.full_name, gpe.reviewer))::int AS contributor_count,
             COUNT(DISTINCT gpe.repo)::int AS repo_count,
             MAX(COALESCE(gpe.merged_at, gpe.first_review_at, gpe.review_requested_at, gpe.opened_at)) AS last_event_at
           FROM github_pr_events gpe
           LEFT JOIN tasks t ON t.id = gpe.task_id
           LEFT JOIN team_members author_tm ON LOWER(author_tm.github_username) = LOWER(gpe.author)
           LEFT JOIN team_members reviewer_tm ON LOWER(reviewer_tm.github_username) = LOWER(gpe.reviewer)
           WHERE COALESCE(gpe.sprint_id, t.sprint_id) = ANY($1::uuid[])
           GROUP BY COALESCE(gpe.sprint_id, t.sprint_id)`,
          [sprintIds]
        )
      : { rows: [] };

    const meetingResp = sprintIds.length && hasMeetingSessions
      ? await orgPool.query(
          `SELECT sprint_id, COUNT(*)::int AS meeting_count
           FROM meeting_sessions
           WHERE sprint_id = ANY($1::uuid[])
           GROUP BY sprint_id`,
          [sprintIds]
        )
      : { rows: [] };

    const openBurnoutResp = hasSprintPerf
      ? await orgPool.query(
          `SELECT COUNT(*)::int AS total
           FROM burnout_alerts
           WHERE resolved = FALSE`
        )
      : { rows: [{ total: 0 }] };

    const unresolvedAlertsResp = hasDelayAlerts
      ? await orgPool.query(
          `SELECT COUNT(*)::int AS total
           FROM delay_alerts
           WHERE acknowledged = FALSE`
        )
      : { rows: [{ total: 0 }] };

    const burnoutBySprint = new Map();
    for (const row of burnoutResp.rows || []) {
      burnoutBySprint.set(String(row.sprint_id), {
        atRiskCount: num(row.at_risk_count),
        avgOverloadPct: num(row.avg_overload_pct),
      });
    }

    const blockedBySprint = new Map();
    for (const row of blockedResp.rows || []) {
      blockedBySprint.set(String(row.sprint_id), num(row.blocked_count));
    }

    const riskBySprint = new Map();
    for (const row of riskResp.rows || []) {
      const score = num(row.delay_risk_score);
      riskBySprint.set(String(row.sprint_id), {
        riskScore: score,
        riskLevel: summarizeRiskLevel(score),
      });
    }

    const alertsBySprint = new Map();
    for (const row of alertResp.rows || []) {
      const sprintId = String(row.sprint_id);
      const bucket = alertsBySprint.get(sprintId) || {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
      };
      const severity = String(row.severity || '').toLowerCase();
      const count = num(row.total);
      bucket.total += count;
      if (severity === 'critical') bucket.critical += count;
      else if (severity === 'warning') bucket.warning += count;
      else bucket.info += count;
      alertsBySprint.set(sprintId, bucket);
    }

    const taskStatsBySprint = new Map();
    for (const row of taskStatsResp.rows || []) {
      taskStatsBySprint.set(String(row.sprint_id), {
        total: num(row.total_tasks),
        todo: num(row.todo_tasks),
        inProgress: num(row.in_progress_tasks),
        inReview: num(row.in_review_tasks),
        done: num(row.done_tasks),
        blocked: num(row.blocked_tasks),
        storyPoints: num(row.total_story_points),
      });
    }

    const githubBySprint = new Map();
    for (const row of githubRawResp.rows || []) {
      githubBySprint.set(String(row.sprint_id), {
        commits: num(row.commit_count),
        pushes: num(row.push_count),
        pullRequests: num(row.pr_count),
        reviews: num(row.review_count),
        issues: num(row.issue_count),
        contributors: num(row.contributor_count),
        repositories: num(row.repo_count),
        additions: num(row.additions),
        deletions: num(row.deletions),
        lastEventAt: row.last_event_at || null,
      });
    }
    for (const row of githubPrResp.rows || []) {
      const sprintKey = String(row.sprint_id);
      const current = githubBySprint.get(sprintKey) || {
        commits: 0,
        pushes: 0,
        pullRequests: 0,
        reviews: 0,
        issues: 0,
        contributors: 0,
        repositories: 0,
        additions: 0,
        deletions: 0,
        lastEventAt: null,
      };
      current.pullRequests += num(row.pr_count);
      current.reviews += num(row.review_count);
      current.contributors = Math.max(current.contributors, num(row.contributor_count));
      current.repositories = Math.max(current.repositories, num(row.repo_count));
      current.lastEventAt = row.last_event_at || current.lastEventAt;
      githubBySprint.set(sprintKey, current);
    }

    const meetingBySprint = new Map();
    for (const row of meetingResp.rows || []) {
      meetingBySprint.set(String(row.sprint_id), num(row.meeting_count));
    }

    const velocityHistory = [...sprints]
      .reverse()
      .map((s) => ({
        sprintId: s.id,
        sprint: s.name,
        status: s.status,
        startDate: s.start_date,
        endDate: s.end_date,
        planned: Number(s.planned_points || 0),
        velocity: Number(s.completed_points || 0),
        completionPct:
          s.planned_points && Number(s.planned_points) > 0
            ? Math.round((Number(s.completed_points || 0) / Number(s.planned_points)) * 1000) / 10
            : null,
      }));

    const burnoutTrend = [...sprints]
      .reverse()
      .map((s) => {
        const bucket = burnoutBySprint.get(String(s.id)) || { atRiskCount: 0, avgOverloadPct: 0 };
        return {
          sprintId: s.id,
          sprint: s.name,
          atRiskCount: bucket.atRiskCount,
          avgOverloadPct: bucket.avgOverloadPct,
        };
      });

    const blockerTrend = [...sprints]
      .reverse()
      .map((s) => ({
        sprintId: s.id,
        sprint: s.name,
        blockedCount: blockedBySprint.get(String(s.id)) || 0,
      }));

    const riskTrend = [...sprints]
      .reverse()
      .map((s) => {
        const risk = riskBySprint.get(String(s.id)) || { riskScore: 0, riskLevel: 'low' };
        return {
          sprintId: s.id,
          sprint: s.name,
          riskScore: risk.riskScore,
          riskLevel: risk.riskLevel,
        };
      });

    const recentReports = sprints.slice(0, 10).map((s) => {
      const alerts = alertsBySprint.get(String(s.id)) || { total: 0, critical: 0, warning: 0, info: 0 };
      const burnout = burnoutBySprint.get(String(s.id)) || { atRiskCount: 0, avgOverloadPct: 0 };
      const blockers = blockedBySprint.get(String(s.id)) || 0;
      const risk = riskBySprint.get(String(s.id)) || { riskScore: 0, riskLevel: 'low' };
      const tasks = taskStatsBySprint.get(String(s.id)) || {
        total: 0,
        todo: 0,
        inProgress: 0,
        inReview: 0,
        done: 0,
        blocked: 0,
        storyPoints: 0,
      };
      const github = githubBySprint.get(String(s.id)) || {
        commits: 0,
        pushes: 0,
        pullRequests: 0,
        reviews: 0,
        issues: 0,
        contributors: 0,
        repositories: 0,
        additions: 0,
        deletions: 0,
        lastEventAt: null,
      };
      const meetings = meetingBySprint.get(String(s.id)) || 0;

      return {
        id: s.id,
        name: `${s.name} Report`,
        sprint: s.name,
        date: s.end_date || s.start_date,
        type: s.status === 'active' ? 'In-Progress' : s.status === 'planned' ? 'Planned' : 'Sprint Summary',
        planned: num(s.planned_points),
        completed: num(s.completed_points),
        completionPct: toPct(s.completed_points, s.planned_points),
        blockedCount: blockers,
        tasksCreated: tasks.total,
        tasksDone: tasks.done,
        tasksInProgress: tasks.inProgress,
        tasksInReview: tasks.inReview,
        tasksTodo: tasks.todo,
        totalStoryPoints: tasks.storyPoints,
        meetings,
        burnoutRiskCount: burnout.atRiskCount,
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        alerts,
        github,
      };
    });

    const avgVelocity = velocityHistory.length
      ? Math.round((velocityHistory.reduce((acc, item) => acc + num(item.velocity), 0) / velocityHistory.length) * 100) / 100
      : 0;

    const completionValues = velocityHistory.map((item) => item.completionPct).filter((item) => typeof item === 'number');
    const avgCompletionPct = completionValues.length
      ? Math.round((completionValues.reduce((acc, item) => acc + num(item), 0) / completionValues.length) * 10) / 10
      : null;

    const latestSprint = velocityHistory.length ? velocityHistory[velocityHistory.length - 1] : null;

    return res.status(200).json({
      summary: {
        avgVelocity,
        avgCompletionPct,
        activeOrRecentSprint: latestSprint?.sprint || null,
        openBurnoutFlags: num(openBurnoutResp.rows[0]?.total),
        unresolvedAlerts: num(unresolvedAlertsResp.rows[0]?.total),
      },
      velocityHistory,
      burnoutTrend,
      blockerTrend,
      riskTrend,
      reports: recentReports,
    });
  } catch (err) {
    return next(err);
  }
}

async function getSprintReport(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const sprintId = String(req.params?.sprintId || '');
    if (!sprintId) return res.status(400).json({ error: 'Invalid sprintId' });

    const sprintResp = await orgPool.query(
      `SELECT id, name, status, start_date, end_date, planned_points, completed_points
       FROM sprints
       WHERE id = $1
       LIMIT 1`,
      [sprintId]
    );
    const sprint = sprintResp.rows[0] || null;
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

    const [hasSprintPerf, hasMeetingSessions, hasDelayAlerts, hasProgressSnapshots, hasGithubEvents, hasGithubPrEvents] = await Promise.all([
      tableExists(orgPool, 'sprint_performance'),
      tableExists(orgPool, 'meeting_sessions'),
      tableExists(orgPool, 'delay_alerts'),
      tableExists(orgPool, 'sprint_progress_snapshots'),
      tableExists(orgPool, 'github_events'),
      tableExists(orgPool, 'github_pr_events'),
    ]);

    const [
      burndownResp,
      riskSnapshotResp,
      blockedResp,
      alertsResp,
      tasksByStatusResp,
      contributorsResp,
      burnoutResp,
      meetingResp,
      githubRawResp,
      githubPrResp,
      githubEventResp,
      githubPrEventResp,
      githubByDevResp,
      githubPrByDevResp,
    ] = await Promise.all([
      hasProgressSnapshots
        ? orgPool.query(
        `SELECT day_number, snapshot_date, ideal_points_remaining, actual_points_remaining, delay_risk_score, velocity_gap_pct
         FROM sprint_progress_snapshots
         WHERE sprint_id = $1
         ORDER BY snapshot_date ASC`,
        [sprintId]
      )
        : Promise.resolve({ rows: [] }),
      hasProgressSnapshots
        ? orgPool.query(
        `SELECT delay_risk_score, velocity_gap_pct, tasks_blocked
         FROM sprint_progress_snapshots
         WHERE sprint_id = $1
         ORDER BY snapshot_date DESC
         LIMIT 1`,
        [sprintId]
      )
        : Promise.resolve({ rows: [] }),
      orgPool.query(
        `SELECT COUNT(*)::int AS blocked_count
         FROM tasks
         WHERE sprint_id = $1 AND status = 'blocked'`,
        [sprintId]
      ),
      hasDelayAlerts
        ? orgPool.query(
        `SELECT id, severity, title, message, suggestion, acknowledged, created_at
         FROM delay_alerts
         WHERE sprint_id = $1
         ORDER BY created_at DESC
         LIMIT 40`,
        [sprintId]
      )
        : Promise.resolve({ rows: [] }),
      orgPool.query(
        `SELECT status, COUNT(*)::int AS total, COALESCE(SUM(story_points), 0)::int AS story_points
         FROM tasks
         WHERE sprint_id = $1
         GROUP BY status`,
        [sprintId]
      ),
      hasSprintPerf
        ? orgPool.query(
        `SELECT tm.full_name, sp.story_points_assigned, sp.story_points_completed, sp.tasks_completed, sp.over_capacity
         FROM sprint_performance sp
         JOIN developer_profiles dp ON dp.id = sp.developer_id
         JOIN team_members tm ON tm.id = dp.member_id
         WHERE sp.sprint_id = $1
         ORDER BY sp.story_points_completed DESC, sp.tasks_completed DESC
         LIMIT 10`,
        [sprintId]
      )
        : Promise.resolve({ rows: [] }),
      hasSprintPerf
        ? orgPool.query(
        `SELECT tm.full_name, sp.story_points_assigned, sp.max_capacity_pts,
                CASE WHEN sp.max_capacity_pts > 0
                     THEN ROUND(((sp.story_points_assigned - sp.max_capacity_pts)::numeric / sp.max_capacity_pts::numeric) * 100, 2)
                     ELSE 0 END AS overload_pct,
                sp.over_capacity
         FROM sprint_performance sp
         JOIN developer_profiles dp ON dp.id = sp.developer_id
         JOIN team_members tm ON tm.id = dp.member_id
         WHERE sp.sprint_id = $1
         ORDER BY sp.over_capacity DESC, overload_pct DESC
         LIMIT 20`,
        [sprintId]
      )
        : Promise.resolve({ rows: [] }),
      hasMeetingSessions
        ? orgPool.query(
        `SELECT id, meeting_type, title, ai_summary, ai_decisions, ai_risks, ai_action_items, scheduled_start
         FROM meeting_sessions
         WHERE sprint_id = $1
         ORDER BY scheduled_start DESC
         LIMIT 20`,
        [sprintId]
      )
        : Promise.resolve({ rows: [] }),
      hasGithubEvents
        ? orgPool.query(
          `SELECT
             COUNT(*) FILTER (WHERE ge.github_commit_sha IS NOT NULL OR ge.event_type IN ('commit'))::int AS commit_count,
             COUNT(*) FILTER (WHERE ge.event_type IN ('push'))::int AS push_count,
             COUNT(*) FILTER (WHERE ge.event_type IN ('pull_request', 'pull_request_opened', 'pull_request_closed', 'pr_opened', 'pr_merged'))::int AS pr_count,
             COUNT(*) FILTER (WHERE ge.event_type IN ('review', 'pull_request_review'))::int AS review_count,
             COUNT(*) FILTER (WHERE ge.event_type IN ('issue', 'issues'))::int AS issue_count,
             COUNT(DISTINCT ge.developer_id)::int AS contributor_count,
             COUNT(DISTINCT ge.repo_name)::int AS repo_count,
             COALESCE(SUM(ge.additions), 0)::int AS additions,
             COALESCE(SUM(ge.deletions), 0)::int AS deletions,
             MAX(ge.event_at) AS last_event_at
           FROM github_events ge
           JOIN tasks t ON t.id = ge.task_id OR t.github_pr_number = ge.github_pr_number
           WHERE t.sprint_id = $1`,
          [sprintId]
        )
        : Promise.resolve({ rows: [] }),
      hasGithubPrEvents
        ? orgPool.query(
          `SELECT
             COUNT(*)::int AS pr_count,
             COUNT(*) FILTER (WHERE gpe.reviewer IS NOT NULL OR gpe.first_review_at IS NOT NULL)::int AS review_count,
             COUNT(DISTINCT COALESCE(author_tm.full_name, gpe.author, reviewer_tm.full_name, gpe.reviewer))::int AS contributor_count,
             COUNT(DISTINCT gpe.repo)::int AS repo_count,
             MAX(COALESCE(gpe.merged_at, gpe.first_review_at, gpe.review_requested_at, gpe.opened_at)) AS last_event_at
           FROM github_pr_events gpe
           LEFT JOIN tasks t ON t.id = gpe.task_id
           LEFT JOIN team_members author_tm ON LOWER(author_tm.github_username) = LOWER(gpe.author)
           LEFT JOIN team_members reviewer_tm ON LOWER(reviewer_tm.github_username) = LOWER(gpe.reviewer)
           WHERE COALESCE(gpe.sprint_id, t.sprint_id) = $1`,
          [sprintId]
        )
        : Promise.resolve({ rows: [] }),
      hasGithubEvents
        ? orgPool.query(
          `SELECT ge.id, ge.event_type, ge.repo_name, ge.github_commit_sha, ge.github_pr_number,
                  ge.branch_name, ge.additions, ge.deletions, ge.event_at,
                  tm.full_name AS developer_name
           FROM github_events ge
           JOIN tasks t ON t.id = ge.task_id OR t.github_pr_number = ge.github_pr_number
           LEFT JOIN developer_profiles dp ON dp.id = ge.developer_id
           LEFT JOIN team_members tm ON tm.id = dp.member_id
           WHERE t.sprint_id = $1
           ORDER BY ge.event_at DESC
           LIMIT 25`,
          [sprintId]
        )
        : Promise.resolve({ rows: [] }),
      hasGithubPrEvents
        ? orgPool.query(
          `SELECT
             gpe.pr_number AS id,
             CASE
               WHEN gpe.merged_at IS NOT NULL THEN 'pull_request_merged'
               WHEN gpe.approved_at IS NOT NULL THEN 'pull_request_review_approved'
               WHEN gpe.first_review_at IS NOT NULL THEN 'pull_request_reviewed'
               WHEN gpe.review_requested_at IS NOT NULL THEN 'pull_request_review_requested'
               ELSE 'pull_request_opened'
             END AS event_type,
             gpe.repo AS repo_name,
             NULL::text AS github_commit_sha,
             gpe.pr_number AS github_pr_number,
             NULL::text AS branch_name,
             0::int AS additions,
             0::int AS deletions,
             COALESCE(gpe.merged_at, gpe.first_review_at, gpe.review_requested_at, gpe.opened_at) AS event_at,
             COALESCE(author_tm.full_name, gpe.author, reviewer_tm.full_name, gpe.reviewer, 'Unknown') AS developer_name
           FROM github_pr_events gpe
           LEFT JOIN tasks t ON t.id = gpe.task_id
           LEFT JOIN team_members author_tm ON LOWER(author_tm.github_username) = LOWER(gpe.author)
           LEFT JOIN team_members reviewer_tm ON LOWER(reviewer_tm.github_username) = LOWER(gpe.reviewer)
           WHERE COALESCE(gpe.sprint_id, t.sprint_id) = $1
           ORDER BY COALESCE(gpe.merged_at, gpe.first_review_at, gpe.review_requested_at, gpe.opened_at) DESC
           LIMIT 25`,
          [sprintId]
        )
        : Promise.resolve({ rows: [] }),
      hasGithubEvents
        ? orgPool.query(
          `SELECT
             COALESCE(tm.full_name, 'Unknown') AS developer_name,
             COUNT(*)::int AS total_events,
             COUNT(*) FILTER (WHERE ge.github_commit_sha IS NOT NULL OR ge.event_type IN ('commit'))::int AS commit_count,
             COUNT(*) FILTER (WHERE ge.event_type IN ('pull_request', 'pull_request_opened', 'pull_request_closed', 'pr_opened', 'pr_merged'))::int AS pr_count,
             COALESCE(SUM(ge.additions), 0)::int AS additions,
             COALESCE(SUM(ge.deletions), 0)::int AS deletions
           FROM github_events ge
           JOIN tasks t ON t.id = ge.task_id OR t.github_pr_number = ge.github_pr_number
           LEFT JOIN developer_profiles dp ON dp.id = ge.developer_id
           LEFT JOIN team_members tm ON tm.id = dp.member_id
           WHERE t.sprint_id = $1
           GROUP BY COALESCE(tm.full_name, 'Unknown')
           ORDER BY total_events DESC, commit_count DESC
           LIMIT 10`,
          [sprintId]
        )
        : Promise.resolve({ rows: [] }),
      hasGithubPrEvents
        ? orgPool.query(
          `SELECT
             COALESCE(author_tm.full_name, gpe.author, reviewer_tm.full_name, gpe.reviewer, 'Unknown') AS developer_name,
             COUNT(*)::int AS total_events,
             COUNT(*)::int AS pr_count,
             COUNT(*) FILTER (WHERE gpe.reviewer IS NOT NULL OR gpe.first_review_at IS NOT NULL)::int AS review_count,
             0::int AS commit_count,
             0::int AS additions,
             0::int AS deletions
           FROM github_pr_events gpe
           LEFT JOIN tasks t ON t.id = gpe.task_id
           LEFT JOIN team_members author_tm ON LOWER(author_tm.github_username) = LOWER(gpe.author)
           LEFT JOIN team_members reviewer_tm ON LOWER(reviewer_tm.github_username) = LOWER(gpe.reviewer)
           WHERE COALESCE(gpe.sprint_id, t.sprint_id) = $1
           GROUP BY COALESCE(author_tm.full_name, gpe.author, reviewer_tm.full_name, gpe.reviewer, 'Unknown')
           ORDER BY total_events DESC
           LIMIT 10`,
          [sprintId]
        )
        : Promise.resolve({ rows: [] }),
    ]);

    const burndown = (burndownResp.rows || []).map((row) => ({
      day: num(row.day_number),
      date: dateOnly(row.snapshot_date),
      idealRemaining: num(row.ideal_points_remaining),
      actualRemaining: num(row.actual_points_remaining),
      delayRiskScore: num(row.delay_risk_score),
      velocityGapPct: num(row.velocity_gap_pct),
    }));

    const latestSnapshot = riskSnapshotResp.rows[0] || null;
    const riskScore = num(latestSnapshot?.delay_risk_score);
    const blockedCount = num(blockedResp.rows[0]?.blocked_count);
    const velocityGapPct = num(latestSnapshot?.velocity_gap_pct);

    const recommendations = [];
    if (blockedCount > 0) recommendations.push('Prioritize blocker removal with owner and ETA on each blocked task.');
    if (velocityGapPct > 20) recommendations.push('Reduce sprint scope or reassign high-point work to close velocity gap.');
    if (riskScore >= 50) recommendations.push('Run daily risk review with Scrum Master, Tech Lead, and product owner.');

    const alerts = (alertsResp.rows || []).map((row) => ({
      id: row.id,
      severity: String(row.severity || 'warning').toLowerCase(),
      title: row.title,
      message: row.message,
      suggestion: row.suggestion,
      acknowledged: Boolean(row.acknowledged),
      createdAt: row.created_at,
    }));

    const taskStatus = (tasksByStatusResp.rows || []).map((row) => ({
      status: row.status,
      count: num(row.total),
      storyPoints: num(row.story_points),
    }));

    const contributors = (contributorsResp.rows || []).map((row) => ({
      name: row.full_name,
      storyPointsAssigned: num(row.story_points_assigned),
      storyPointsCompleted: num(row.story_points_completed),
      tasksCompleted: num(row.tasks_completed),
      overCapacity: Boolean(row.over_capacity),
    }));

    const burnout = (burnoutResp.rows || []).map((row) => ({
      name: row.full_name,
      storyPointsAssigned: num(row.story_points_assigned),
      maxCapacity: num(row.max_capacity_pts),
      overloadPct: num(row.overload_pct),
      overCapacity: Boolean(row.over_capacity),
    }));

    const meetings = (meetingResp.rows || []).map((row) => ({
      id: row.id,
      type: row.meeting_type,
      title: row.title,
      summary: row.ai_summary,
      decisions: row.ai_decisions,
      risks: row.ai_risks,
      actionItems: Array.isArray(row.ai_action_items) ? row.ai_action_items : [],
      scheduledStart: row.scheduled_start,
    }));

    const githubSummary = (() => {
      const raw = githubRawResp.rows[0] || null;
      const pr = githubPrResp.rows[0] || null;
      const contributors = new Set();
      const repositories = new Set();

      for (const row of githubByDevResp.rows || []) {
        if (row.developer_name) contributors.add(String(row.developer_name));
      }
      for (const row of githubPrByDevResp.rows || []) {
        if (row.developer_name) contributors.add(String(row.developer_name));
      }

      for (const row of githubEventResp.rows || []) {
        if (row.repo_name) repositories.add(String(row.repo_name));
      }
      for (const row of githubPrEventResp.rows || []) {
        if (row.repo_name) repositories.add(String(row.repo_name));
      }

      return {
        commits: num(raw?.commit_count),
        pushes: num(raw?.push_count),
        pullRequests: num(raw?.pr_count) + num(pr?.pr_count),
        reviews: num(raw?.review_count) + num(pr?.review_count),
        issues: num(raw?.issue_count),
        contributors: contributors.size || num(raw?.contributor_count) + num(pr?.contributor_count),
        repositories: repositories.size || num(raw?.repo_count) + num(pr?.repo_count),
        additions: num(raw?.additions),
        deletions: num(raw?.deletions),
        lastEventAt: raw?.last_event_at || pr?.last_event_at || null,
      };
    })();

    const githubEvents = [
      ...(githubEventResp.rows || []).map((row) => ({
        id: String(row.id),
        type: row.event_type,
        repo: row.repo_name || null,
        developer: row.developer_name || 'Unknown',
        commitSha: row.github_commit_sha || null,
        prNumber: row.github_pr_number || null,
        branch: row.branch_name || null,
        additions: num(row.additions),
        deletions: num(row.deletions),
        eventAt: row.event_at,
      })),
      ...(githubPrEventResp.rows || []).map((row) => ({
        id: String(row.id),
        type: row.event_type,
        repo: row.repo_name || null,
        developer: row.developer_name || 'Unknown',
        commitSha: null,
        prNumber: num(row.github_pr_number) || null,
        branch: null,
        additions: num(row.additions),
        deletions: num(row.deletions),
        eventAt: row.event_at,
      })),
    ].sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime()).slice(0, 25);

    const githubByDeveloperMap = new Map();
    for (const row of githubByDevResp.rows || []) {
      const name = String(row.developer_name || 'Unknown');
      const bucket = githubByDeveloperMap.get(name) || { developer: name, totalEvents: 0, commits: 0, pullRequests: 0, additions: 0, deletions: 0 };
      bucket.totalEvents += num(row.total_events);
      bucket.commits += num(row.commit_count);
      bucket.pullRequests += num(row.pr_count);
      bucket.additions += num(row.additions);
      bucket.deletions += num(row.deletions);
      githubByDeveloperMap.set(name, bucket);
    }
    for (const row of githubPrByDevResp.rows || []) {
      const name = String(row.developer_name || 'Unknown');
      const bucket = githubByDeveloperMap.get(name) || { developer: name, totalEvents: 0, commits: 0, pullRequests: 0, additions: 0, deletions: 0 };
      bucket.totalEvents += num(row.total_events);
      bucket.pullRequests += num(row.pr_count);
      bucket.totalEvents += num(row.review_count);
      githubByDeveloperMap.set(name, bucket);
    }
    const githubByDeveloper = Array.from(githubByDeveloperMap.values())
      .sort((a, b) => b.totalEvents - a.totalEvents || b.commits - a.commits)
      .slice(0, 10);

    const hasGithubData =
      githubSummary.commits > 0 ||
      githubSummary.pullRequests > 0 ||
      githubSummary.issues > 0 ||
      githubEvents.length > 0 ||
      githubByDeveloper.length > 0;

    const githubFallback = hasGithubData ? null : await fetchGithubFallbackForSprint(orgPool, sprint);
    const finalGithubSummary = githubFallback?.summary || githubSummary;
    const finalGithubByDeveloper = githubFallback?.byDeveloper || githubByDeveloper;
    const finalGithubEvents = githubFallback?.recentEvents || githubEvents;

    return res.status(200).json({
      sprint: {
        id: sprint.id,
        name: sprint.name,
        status: sprint.status,
        startDate: sprint.start_date,
        endDate: sprint.end_date,
        plannedPoints: num(sprint.planned_points),
        completedPoints: num(sprint.completed_points),
        completionPct: toPct(sprint.completed_points, sprint.planned_points),
      },
      burndown,
      risk: {
        riskScore,
        riskLevel: summarizeRiskLevel(riskScore),
        velocityGapPct,
        blockedCount,
        recommendations,
      },
      alerts,
      tasks: {
        byStatus: taskStatus,
        blockedCount,
      },
      contributors,
      burnout,
      meetings,
      github: {
        summary: finalGithubSummary,
        byDeveloper: finalGithubByDeveloper,
        recentEvents: finalGithubEvents,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function exportSprintReportCsv(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const sprintId = String(req.params?.sprintId || '');
    if (!sprintId) return res.status(400).json({ error: 'Invalid sprintId' });

    const sprintResp = await orgPool.query(
      `SELECT id, name, status, start_date, end_date, planned_points, completed_points
       FROM sprints
       WHERE id = $1
       LIMIT 1`,
      [sprintId]
    );
    const sprint = sprintResp.rows[0] || null;
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

    const [tasksResp, alertsResp, burnoutResp] = await Promise.all([
      orgPool.query(
        `SELECT status, COUNT(*)::int AS total, COALESCE(SUM(story_points), 0)::int AS points
         FROM tasks
         WHERE sprint_id = $1
         GROUP BY status
         ORDER BY status ASC`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT severity, COUNT(*)::int AS total
         FROM delay_alerts
         WHERE sprint_id = $1
         GROUP BY severity
         ORDER BY severity ASC`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT COUNT(*) FILTER (WHERE over_capacity = TRUE)::int AS over_capacity_count
         FROM sprint_performance
         WHERE sprint_id = $1`,
        [sprintId]
      ),
    ]);

    const rows = [];
    rows.push(['Section', 'Metric', 'Value']);
    rows.push(['Sprint', 'Name', sprint.name]);
    rows.push(['Sprint', 'Status', sprint.status]);
    rows.push(['Sprint', 'Start Date', dateOnly(sprint.start_date)]);
    rows.push(['Sprint', 'End Date', dateOnly(sprint.end_date)]);
    rows.push(['Delivery', 'Planned Points', num(sprint.planned_points)]);
    rows.push(['Delivery', 'Completed Points', num(sprint.completed_points)]);
    rows.push(['Delivery', 'Completion %', toPct(sprint.completed_points, sprint.planned_points)]);
    rows.push(['Burnout', 'Over Capacity Contributors', num(burnoutResp.rows[0]?.over_capacity_count)]);

    for (const item of tasksResp.rows || []) {
      rows.push(['Tasks', `${item.status} Count`, num(item.total)]);
      rows.push(['Tasks', `${item.status} Points`, num(item.points)]);
    }
    for (const item of alertsResp.rows || []) {
      rows.push(['Alerts', `${item.severity} Count`, num(item.total)]);
    }

    const csv = toCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sprint-report-${sprintId}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    return next(err);
  }
}

async function getSprintAuditReport(req, res, next) {
  try {
    const orgPool = req.orgDb;
    if (!orgPool) return res.status(500).json({ error: 'Org DB not attached' });

    const sprintId = String(req.params?.sprintId || '').trim();
    if (!sprintId) return res.status(400).json({ error: 'Invalid sprintId' });

    const sprintResp = await orgPool.query(
      `SELECT id, project_id, name, goal, status, start_date, end_date, planned_points, completed_points
       FROM sprints
       WHERE id = $1
       LIMIT 1`,
      [sprintId]
    );
    const sprint = sprintResp.rows[0] || null;
    if (!sprint) return res.status(404).json({ error: 'Sprint not found' });

    const [
      tasksResp,
      velocityResp,
      membersResp,
      backlogResp,
      blockerResp,
      assignmentChangesResp,
      githubByDevResp,
      leaveResp,
    ] = await Promise.all([
      orgPool.query(
        `SELECT
           t.id, t.title, t.description, t.status, t.priority, t.story_points,
           t.tech_tags, t.created_at, t.updated_at, t.started_at, t.completed_at,
           t.assignee_id, t.due_date, t.acceptance_criteria, t.github_pr_number,
           t.jira_issue_key,
           tm.full_name AS assignee_name,
           dp.tech_stack AS assignee_skills
         FROM tasks t
         LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
         LEFT JOIN team_members tm ON tm.id = dp.member_id
         WHERE t.sprint_id = $1
         ORDER BY t.created_at ASC`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT id, name, start_date, end_date, planned_points, completed_points
         FROM sprints
         WHERE project_id = $1 AND status IN ('completed','active')
         ORDER BY start_date DESC
         LIMIT 5`,
        [String(sprint.project_id)]
      ),
      orgPool.query(
        `SELECT
           dp.id AS developer_id,
           tm.full_name,
           tm.role,
           dp.tech_stack,
           dp.current_sprint_load,
           dp.max_sprint_capacity,
           COALESCE(sp.story_points_assigned, 0)::int AS tasks_assigned_points
         FROM developer_profiles dp
         JOIN team_members tm ON tm.id = dp.member_id
         LEFT JOIN sprint_performance sp ON sp.developer_id = dp.id AND sp.sprint_id = $1
         WHERE tm.is_active = TRUE
         ORDER BY tm.full_name ASC`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT
           bi.id, bi.title, bi.description, bi.priority, bi.story_points,
           bi.acceptance_criteria, bi.tech_tags, bi.status, bi.created_at, bi.updated_at,
           bi.reporter_id,
           tm.full_name AS owner_name
         FROM backlog_items bi
         LEFT JOIN team_members tm ON tm.id = bi.reporter_id
         WHERE bi.project_id = $1
         ORDER BY bi.created_at ASC`,
        [String(sprint.project_id)]
      ),
      orgPool.query(
        `SELECT id, alert_type, severity, title, message, created_at, acknowledged, acknowledged_at
         FROM delay_alerts
         WHERE sprint_id = $1
         ORDER BY created_at DESC`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT task_id, COUNT(DISTINCT developer_id)::int AS assignee_count
         FROM assignment_log
         WHERE task_id IN (SELECT id FROM tasks WHERE sprint_id = $1)
         GROUP BY task_id
         HAVING COUNT(DISTINCT developer_id) > 1`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT
           COUNT(*) FILTER (WHERE ge.github_commit_sha IS NOT NULL OR ge.event_type IN ('commit'))::int AS commits,
           COUNT(*) FILTER (WHERE ge.event_type IN ('pull_request', 'pull_request_opened', 'pull_request_closed', 'pr_opened', 'pr_merged'))::int AS prs,
           COUNT(*) FILTER (WHERE ge.event_type IN ('review', 'pull_request_review'))::int AS reviews
         FROM github_events ge
         LEFT JOIN tasks t ON t.id = ge.task_id
         WHERE t.sprint_id = $1`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT
           ge.developer_id,
           tm.full_name,
           COUNT(*) FILTER (WHERE ge.github_commit_sha IS NOT NULL OR ge.event_type IN ('commit'))::int AS commits,
           COUNT(*) FILTER (WHERE ge.event_type IN ('pull_request', 'pull_request_opened', 'pull_request_closed', 'pr_opened', 'pr_merged'))::int AS prs,
           COUNT(*) FILTER (WHERE ge.event_type IN ('review', 'pull_request_review'))::int AS reviews
         FROM github_events ge
         LEFT JOIN tasks t ON t.id = ge.task_id
         LEFT JOIN developer_profiles dp ON dp.id = ge.developer_id
         LEFT JOIN team_members tm ON tm.id = dp.member_id
         WHERE t.sprint_id = $1
         GROUP BY ge.developer_id, tm.full_name`,
        [sprintId]
      ),
      orgPool.query(
        `SELECT dp.id AS developer_id, da.start_date, da.end_date, da.leave_type
         FROM developer_availability da
         JOIN developer_profiles dp ON dp.id = da.developer_id
         WHERE da.start_date <= $2::date AND da.end_date >= $1::date`,
        [sprint.start_date, sprint.end_date]
      ),
    ]);

    const nowIso = new Date().toISOString();
    const sprintStart = new Date(sprint.start_date);
    const tasks = tasksResp.rows || [];
    const backlog = backlogResp.rows || [];
    const members = membersResp.rows || [];
    const blockers = blockerResp.rows || [];

    const committedPoints = Number(sprint.planned_points || 0);
    const donePoints = tasks
      .filter((t) => String(t.status) === 'done')
      .reduce((acc, t) => acc + Number(t.story_points || 0), 0);
    const completionRate = committedPoints > 0 ? Math.round((donePoints / committedPoints) * 1000) / 10 : 0;

    const scopeCreep = tasks
      .filter((t) => new Date(t.created_at) > sprintStart)
      .map((t) => ({
        task_id: t.id,
        title: t.title,
        added_at: t.created_at,
      }));

    const overdueTasks = tasks
      .filter((t) => t.due_date && !['done', 'cancelled'].includes(String(t.status)))
      .map((t) => ({
        task_id: t.id,
        title: t.title,
        assignee: t.assignee_name || 'Unassigned',
        days_overdue: daysDiff(t.due_date, nowIso),
      }))
      .filter((t) => t.days_overdue > 0)
      .sort((a, b) => b.days_overdue - a.days_overdue);

    const activeDaysElapsed = Math.max(1, daysDiff(sprint.start_date, nowIso) + 1);
    const remainingDays = Math.max(0, daysDiff(nowIso, sprint.end_date));
    const currentDailyPoints = donePoints / activeDaysElapsed;
    const carryOverRisk = tasks
      .filter((t) => !['done', 'cancelled'].includes(String(t.status)))
      .map((t) => {
        const points = Number(t.story_points || 0);
        const likely = remainingDays === 0 || (points > 0 && currentDailyPoints * remainingDays < points);
        return {
          task_id: t.id,
          title: t.title,
          assignee: t.assignee_name || 'Unassigned',
          status: t.status,
          likely_carry_over: likely,
        };
      })
      .filter((t) => t.likely_carry_over);

    const goalTokens = tokenizeText(sprint.goal);
    const sprintGoalAlignment = tasks.map((t) => {
      const taskTokens = new Set([...tokenizeText(t.title), ...tokenizeText(t.description), ...normalizeTags(t.tech_tags)]);
      const matches = goalTokens.filter((token) => taskTokens.has(token)).length;
      const aligned = goalTokens.length === 0 ? true : matches > 0;
      return {
        task_id: t.id,
        title: t.title,
        aligned,
        match_count: matches,
      };
    });

    const unplannedWorkRatio = tasks.length > 0 ? Math.round((scopeCreep.length / tasks.length) * 1000) / 10 : 0;
    const alignmentRatio = sprintGoalAlignment.length > 0 ? sprintGoalAlignment.filter((t) => t.aligned).length / sprintGoalAlignment.length : 1;
    const goalClarityScore = clamp(Math.round((alignmentRatio * 70 + (sprint.goal ? 30 : 0)) * 100) / 100, 0, 100);
    const sprintHealthScore = clamp(
      Math.round((completionRate * 0.45 + goalClarityScore * 0.25 + (100 - Math.min(100, unplannedWorkRatio)) * 0.15 + (100 - Math.min(100, overdueTasks.length * 10)) * 0.15) * 100) / 100,
      0,
      100
    );

    const staleItems = backlog
      .map((b) => ({
        backlog_id: b.id,
        title: b.title,
        age_in_days: daysDiff(b.updated_at || b.created_at, nowIso),
        priority: b.priority,
        owner: b.owner_name || 'Unassigned',
      }))
      .filter((b) => b.age_in_days > 30);

    const missingStoryPoints = backlog.filter((b) => b.story_points === null || b.story_points === undefined);
    const missingCriteria = backlog
      .filter((b) => !String(b.description || '').trim() || !String(b.acceptance_criteria || '').trim())
      .map((b) => ({ backlog_id: b.id, title: b.title, priority: b.priority }));

    const priorityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const item of backlog) {
      const p = String(item.priority || 'low').toLowerCase();
      if (p === 'critical' || p === 'high' || p === 'medium' || p === 'low') priorityCounts[p] += 1;
    }
    const totalBacklog = Math.max(1, backlog.length);
    const priorityDistribution = {
      critical: Math.round((priorityCounts.critical / totalBacklog) * 1000) / 10,
      high: Math.round((priorityCounts.high / totalBacklog) * 1000) / 10,
      medium: Math.round((priorityCounts.medium / totalBacklog) * 1000) / 10,
      low: Math.round((priorityCounts.low / totalBacklog) * 1000) / 10,
    };

    const duplicateRisk = [];
    for (let i = 0; i < backlog.length; i += 1) {
      for (let j = i + 1; j < backlog.length; j += 1) {
        const a = tokenizeText(backlog[i].title);
        const b = tokenizeText(backlog[j].title);
        if (!a.length || !b.length) continue;
        const intersection = a.filter((x) => b.includes(x)).length;
        const score = intersection / Math.max(a.length, b.length);
        if (score >= 0.6) {
          duplicateRisk.push({
            item_a: backlog[i].title,
            item_b: backlog[j].title,
            similarity_score: Math.round(score * 1000) / 10,
          });
        }
      }
    }

    const ungroomedCount = backlog.filter((b) => {
      const noPoints = b.story_points === null || b.story_points === undefined;
      const noCriteria = !String(b.acceptance_criteria || '').trim();
      const notReady = String(b.status || '').toLowerCase() !== 'ready';
      return noPoints || noCriteria || notReady;
    }).length;
    const ungroomedPercentage = backlog.length > 0 ? Math.round((ungroomedCount / backlog.length) * 1000) / 10 : 0;

    const recommendedForNextSprint = backlog
      .map((b) => {
        const hasPoints = b.story_points !== null && b.story_points !== undefined ? 1 : 0;
        const hasCriteria = String(b.acceptance_criteria || '').trim() ? 1 : 0;
        const readyStatus = String(b.status || '').toLowerCase() === 'ready' ? 1 : 0;
        const readiness = (hasPoints + hasCriteria + readyStatus) / 3;
        const score = priorityWeight(b.priority) * readiness;
        return {
          backlog_id: b.id,
          title: b.title,
          priority: b.priority,
          readiness_score: Math.round(readiness * 1000) / 10,
          ranking_score: Math.round(score * 1000) / 10,
          reasoning: `Priority ${String(b.priority || 'medium')} with readiness ${Math.round(readiness * 100)}%.`,
        };
      })
      .sort((a, b) => b.ranking_score - a.ranking_score)
      .slice(0, 5);

    const orgSkillUniverse = new Set();
    members.forEach((m) => normalizeTags(m.tech_stack).forEach((s) => orgSkillUniverse.add(s)));

    const completedTasksByDev = new Map();
    tasks
      .filter((t) => String(t.status) === 'done' && t.assignee_id)
      .forEach((t) => {
        const key = String(t.assignee_id);
        const bucket = completedTasksByDev.get(key) || [];
        bucket.push(...normalizeTags(t.tech_tags));
        completedTasksByDev.set(key, bucket);
      });

    const assignedPointsByDev = new Map();
    tasks.forEach((t) => {
      const key = t.assignee_id ? String(t.assignee_id) : 'unassigned';
      assignedPointsByDev.set(key, (assignedPointsByDev.get(key) || 0) + Number(t.story_points || 0));
    });
    const devPointValues = members.map((m) => assignedPointsByDev.get(String(m.developer_id)) || 0);
    const avgAssignedPoints = devPointValues.length ? devPointValues.reduce((a, b) => a + b, 0) / devPointValues.length : 0;

    const backlogSkills = new Set();
    backlog.forEach((b) => normalizeTags(b.tech_tags).forEach((s) => backlogSkills.add(s)));
    const skillGap = [...backlogSkills].filter((s) => !orgSkillUniverse.has(s));

    const taskMismatch = tasks
      .filter((t) => t.assignee_id)
      .map((t) => {
        const assignee = members.find((m) => String(m.developer_id) === String(t.assignee_id));
        const declared = new Set(normalizeTags(assignee?.tech_stack));
        const required = normalizeTags(t.tech_tags);
        const matched = required.filter((r) => declared.has(r)).length;
        const mismatch = required.length > 0 && matched === 0;
        return {
          task_id: t.id,
          title: t.title,
          developer_id: t.assignee_id,
          developer_name: t.assignee_name || 'Unknown',
          required_skills: required,
          declared_skills: [...declared],
          mismatch,
        };
      })
      .filter((t) => t.mismatch);

    const overloadedDevelopers = members
      .filter((m) => (assignedPointsByDev.get(String(m.developer_id)) || 0) > avgAssignedPoints)
      .map((m) => ({
        developer_id: m.developer_id,
        name: m.full_name,
        assigned_story_points: assignedPointsByDev.get(String(m.developer_id)) || 0,
      }));

    const underutilisedDevelopers = members
      .filter((m) => (assignedPointsByDev.get(String(m.developer_id)) || 0) < avgAssignedPoints * 0.5)
      .map((m) => ({
        developer_id: m.developer_id,
        name: m.full_name,
        assigned_story_points: assignedPointsByDev.get(String(m.developer_id)) || 0,
        capacity: Number(m.max_sprint_capacity || 0),
      }));

    const developerAuditRows = members.map((m) => {
      const declared = normalizeTags(m.tech_stack);
      const demonstrated = [...new Set(completedTasksByDev.get(String(m.developer_id)) || [])];
      const personalGap = declared.filter((s) => !demonstrated.includes(s));
      const recommendedSkill = skillGap[0] || personalGap[0] || null;
      return {
        developer_id: m.developer_id,
        name: m.full_name,
        role: m.role,
        skills_declared: declared,
        skills_demonstrated: demonstrated,
        recommended_upskilling: recommendedSkill
          ? {
              skill_area: recommendedSkill,
              related_backlog_items: backlog
                .filter((b) => normalizeTags(b.tech_tags).includes(recommendedSkill))
                .slice(0, 3)
                .map((b) => b.title),
            }
          : null,
      };
    });

    const skillOwners = new Map();
    members.forEach((m) => {
      normalizeTags(m.tech_stack).forEach((s) => {
        const owners = skillOwners.get(s) || new Set();
        owners.add(String(m.developer_id));
        skillOwners.set(s, owners);
      });
    });
    const busFactorRisk = [...skillOwners.entries()]
      .filter(([, owners]) => owners.size === 1)
      .map(([skill, owners]) => ({ skill, owner_developer_id: [...owners][0] }));

    const velocityTrend = velocityResp.rows
      .map((s) => Number(s.completed_points || 0))
      .reverse();
    const prevVelocity = velocityTrend.length >= 2 ? velocityTrend[velocityTrend.length - 2] : velocityTrend[0] || 0;
    const curVelocity = velocityTrend.length ? velocityTrend[velocityTrend.length - 1] : 0;
    const velocityChangePct = prevVelocity > 0 ? Math.round((((curVelocity - prevVelocity) / prevVelocity) * 100) * 100) / 100 : 0;
    const velocityStability = velocityChangePct > 10 ? 'improving' : velocityChangePct < -10 ? 'declining' : 'stable';

    const completedWithDates = tasks.filter((t) => t.started_at && t.completed_at);
    const averageCycleTime = completedWithDates.length
      ? Math.round((completedWithDates.reduce((acc, t) => acc + daysDiff(t.started_at, t.completed_at), 0) / completedWithDates.length) * 100) / 100
      : 0;

    const previousSprint = velocityResp.rows.length > 1 ? velocityResp.rows[1] : null;
    let avgCycleTimeTrend = 0;
    if (previousSprint?.id) {
      const prevTasksResp = await orgPool.query(
        `SELECT started_at, completed_at FROM tasks WHERE sprint_id = $1 AND started_at IS NOT NULL AND completed_at IS NOT NULL`,
        [String(previousSprint.id)]
      );
      const prevTasks = prevTasksResp.rows || [];
      const prevCycle = prevTasks.length
        ? prevTasks.reduce((acc, t) => acc + daysDiff(t.started_at, t.completed_at), 0) / prevTasks.length
        : 0;
      if (prevCycle > 0) {
        avgCycleTimeTrend = Math.round((((averageCycleTime - prevCycle) / prevCycle) * 100) * 100) / 100;
      }
    }

    const recent3 = velocityResp.rows.slice(0, 3);
    const sprintPredictabilityScore = recent3.length
      ? Math.round((recent3.reduce((acc, s) => {
          const p = Number(s.planned_points || 0);
          const c = Number(s.completed_points || 0);
          const pct = p > 0 ? Math.min(100, (c / p) * 100) : 0;
          return acc + pct;
        }, 0) / recent3.length) * 100) / 100
      : 0;

    const longestOpenTasks = tasks
      .filter((t) => !['done', 'cancelled'].includes(String(t.status)))
      .map((t) => ({
        task_id: t.id,
        title: t.title,
        status: t.status,
        age_in_days: daysDiff(t.created_at, nowIso),
      }))
      .sort((a, b) => b.age_in_days - a.age_in_days)
      .slice(0, 3);

    const githubByDev = githubByDevResp.rows || [];
    const reviewBottleneck = githubByDev
      .filter((d) => Number(d.prs || 0) > 0 && Number(d.reviews || 0) === 0)
      .map((d) => ({
        developer_id: d.developer_id,
        developer_name: d.full_name || 'Unknown',
        prs_open: Number(d.prs || 0),
        note: 'PR activity exists with low review throughput.',
      }));

    const activeBlockers = blockers
      .filter((b) => String(b.alert_type || '').toLowerCase().includes('block') && !b.acknowledged)
      .map((b) => ({
        blocker_id: b.id,
        title: b.title,
        severity: b.severity,
        age_in_days: daysDiff(b.created_at, nowIso),
      }));

    const resolvedBlockers = blockers.filter((b) => String(b.alert_type || '').toLowerCase().includes('block') && b.acknowledged && b.acknowledged_at);
    const avgBlockerResolutionTime = resolvedBlockers.length
      ? Math.round((resolvedBlockers.reduce((acc, b) => acc + ((new Date(b.acknowledged_at).getTime() - new Date(b.created_at).getTime()) / (1000 * 60 * 60)), 0) / resolvedBlockers.length) * 100) / 100
      : 0;

    const recurringBlockers = Object.entries(
      blockers.reduce((acc, b) => {
        const key = String(b.title || '').toLowerCase().split(':')[0] || 'general';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    )
      .filter(([, count]) => Number(count) > 1)
      .map(([blocker_type, count]) => ({ blocker_type, occurrences: count }));

    const dependencyRisks = tasks
      .filter((t) => normalizeTags(t.tech_tags).some((tag) => ['dependency', 'external', 'third-party', 'jira'].includes(tag)))
      .map((t) => ({ task_id: t.id, title: t.title, status: t.status, tags: normalizeTags(t.tech_tags) }));

    const atRiskTasks = tasks
      .filter((t) => !['done', 'cancelled'].includes(String(t.status)) && daysDiff(t.updated_at, nowIso) >= 3)
      .map((t) => ({
        task_id: t.id,
        title: t.title,
        assignee: t.assignee_name || 'Unassigned',
        days_since_update: daysDiff(t.updated_at, nowIso),
      }));

    const teamBandwidthRisk = leaveResp.rows.map((r) => ({
      developer_id: r.developer_id,
      leave_type: r.leave_type,
      start_date: r.start_date,
      end_date: r.end_date,
    }));

    const tasksWithoutEstimates = tasks
      .filter((t) => t.story_points === null || t.story_points === undefined || Number(t.story_points) === 0)
      .map((t) => ({ task_id: t.id, title: t.title, assignee: t.assignee_name || 'Unassigned' }));

    const reassignedTaskIds = new Set((assignmentChangesResp.rows || []).map((r) => String(r.task_id)));
    const tasksReassigned = tasks
      .filter((t) => reassignedTaskIds.has(String(t.id)))
      .map((t) => ({ task_id: t.id, title: t.title }));

    const lateStarts = tasks
      .filter((t) => t.started_at)
      .map((t) => ({
        task_id: t.id,
        title: t.title,
        started_after_days: daysDiff(sprint.start_date, t.started_at),
      }))
      .filter((t) => t.started_after_days > 3);

    const definitionOfDoneCompliance = tasks
      .filter((t) => String(t.status) === 'done')
      .map((t) => ({
        task_id: t.id,
        title: t.title,
        has_linked_pr: Boolean(t.github_pr_number),
        has_linked_jira_issue: Boolean(t.jira_issue_key),
        compliant: Boolean(t.github_pr_number || t.jira_issue_key),
      }))
      .filter((t) => !t.compliant);

    const standupAnomalies = tasks
      .filter((t) => !['done', 'cancelled'].includes(String(t.status)) && daysDiff(t.updated_at, nowIso) >= 3)
      .map((t) => ({
        task_id: t.id,
        title: t.title,
        status: t.status,
        stale_days: daysDiff(t.updated_at, nowIso),
      }));

    const avgTasksPerDeveloper = members.length > 0 ? Math.round((tasks.filter((t) => t.assignee_id).length / members.length) * 100) / 100 : 0;
    const taskCountByDev = members.map((m) => tasks.filter((t) => String(t.assignee_id || '') === String(m.developer_id)).length);
    const maxTasks = taskCountByDev.length ? Math.max(...taskCountByDev) : 0;
    const minTasks = taskCountByDev.length ? Math.min(...taskCountByDev) : 0;
    const equitable = maxTasks - minTasks <= 2;

    const backlogSectionScore = clamp(
      Math.round((100 - Math.min(100, (staleItems.length / Math.max(1, backlog.length)) * 100) - Math.min(100, (missingStoryPoints.length / Math.max(1, backlog.length)) * 100) - Math.min(100, ungroomedPercentage)) * 100) / 100,
      0,
      100
    );
    const developerSectionScore = clamp(
      Math.round((100 - Math.min(100, (taskMismatch.length / Math.max(1, tasks.length)) * 100) - Math.min(100, overloadedDevelopers.length * 8) - Math.min(100, skillGap.length * 10)) * 100) / 100,
      0,
      100
    );
    const velocitySectionScore = clamp(
      Math.round((sprintPredictabilityScore * 0.6 + (velocityStability === 'improving' ? 90 : velocityStability === 'stable' ? 70 : 40) * 0.4) * 100) / 100,
      0,
      100
    );
    const riskSectionScore = clamp(
      Math.round((100 - Math.min(100, activeBlockers.length * 12) - Math.min(100, atRiskTasks.length * 8) - Math.min(100, teamBandwidthRisk.length * 10)) * 100) / 100,
      0,
      100
    );
    const processSectionScore = clamp(
      Math.round((100 - Math.min(100, tasksWithoutEstimates.length * 8) - Math.min(100, tasksReassigned.length * 6) - Math.min(100, lateStarts.length * 6) - Math.min(100, standupAnomalies.length * 5)) * 100) / 100,
      0,
      100
    );

    const nextSprintReadinessScore = clamp(
      Math.round((100 - Math.min(100, ungroomedPercentage) - Math.min(100, (missingStoryPoints.length / Math.max(1, backlog.length)) * 100) - Math.min(100, missingCriteria.length * 3)) * 100) / 100,
      0,
      100
    );

    const recommendationsSectionScore = clamp(
      Math.round((nextSprintReadinessScore * 0.6 + backlogSectionScore * 0.2 + processSectionScore * 0.2) * 100) / 100,
      0,
      100
    );

    const groqAudit = await callGroqAuditInsights(
      buildAuditPrompt({
        sprint: {
          name: sprint.name,
          status: sprint.status,
          completion_rate: completionRate,
          sprint_predictability_score: sprintPredictabilityScore,
          velocity_stability: velocityStability,
        },
        backlog: {
          missing_story_points: missingStoryPoints.length,
          ungroomed_percentage: ungroomedPercentage,
          priority_distribution: priorityDistribution,
        },
        skillGap,
        overloadedDevelopers,
        underutilisedDevelopers,
        taskMismatch,
        recommendations: {
          top_3_immediate_actions: [
            'Resolve active blockers older than 2 days and assign explicit owners with ETA.',
            'Re-scope or split carry-over-risk tasks before sprint end to protect predictability.',
            'Redistribute overloaded developer workload to underutilised contributors this sprint.',
          ],
          top_3_process_improvements: [
            'Enforce estimate and acceptance-criteria checks before items move to sprint-ready.',
            'Introduce mid-sprint assignment review for mismatch and reassignment reduction.',
            'Track stale in-progress tasks daily and escalate after 3 days without updates.',
          ],
        },
      })
    ).catch(() => null);

    const fallbackAudit = buildFallbackAuditInsights({
      sprintName: sprint.name,
      skillGap,
      overloadedDevelopers,
      underutilisedDevelopers,
      taskMismatch,
      recommendations: {
        top_3_immediate_actions: [
          'Resolve active blockers older than 2 days and assign explicit owners with ETA.',
          'Re-scope or split carry-over-risk tasks before sprint end to protect predictability.',
          'Redistribute overloaded developer workload to underutilised contributors this sprint.',
        ],
      },
    });

    const aiInsights = groqAudit || fallbackAudit;

    const response = {
      audit_generated_at: new Date().toISOString(),
      sprint_id: sprintId,
      org_id: String(req.user?.orgId || ''),
      sprint_health: {
        section_score: sprintHealthScore,
        section_status: statusFromScore(sprintHealthScore),
        overall_health_score: sprintHealthScore,
        goal_clarity_score: goalClarityScore,
        scope_creep_detected: {
          detected: scopeCreep.length > 0,
          tasks_added_after_start: scopeCreep,
        },
        completion_rate: completionRate,
        overdue_tasks: overdueTasks,
        carry_over_risk: carryOverRisk,
        sprint_goal_alignment: sprintGoalAlignment,
        unplanned_work_ratio: unplannedWorkRatio,
      },
      backlog_audit: {
        section_score: backlogSectionScore,
        section_status: statusFromScore(backlogSectionScore),
        stale_items: staleItems,
        missing_story_points: {
          count: missingStoryPoints.length,
          items: missingStoryPoints.map((b) => ({ backlog_id: b.id, title: b.title, priority: b.priority })),
        },
        priority_distribution: priorityDistribution,
        missing_acceptance_criteria: missingCriteria,
        duplicate_risk: duplicateRisk,
        ungroomed_percentage: ungroomedPercentage,
        recommended_for_next_sprint: recommendedForNextSprint,
      },
      developer_audit: {
        section_score: developerSectionScore,
        section_status: statusFromScore(developerSectionScore),
        developers: developerAuditRows,
        skill_gap: skillGap,
        overloaded_developers: overloadedDevelopers,
        underutilised_developers: underutilisedDevelopers,
        task_mismatch: taskMismatch,
        recommended_upskilling: developerAuditRows
          .filter((d) => Boolean(d.recommended_upskilling))
          .map((d) => ({ developer_id: d.developer_id, name: d.name, ...d.recommended_upskilling })),
        bus_factor_risk: busFactorRisk,
      },
      velocity_audit: {
        section_score: velocitySectionScore,
        section_status: statusFromScore(velocitySectionScore),
        velocity_trend: velocityTrend,
        velocity_stability: {
          trend: velocityStability,
          change_pct: velocityChangePct,
        },
        average_cycle_time: averageCycleTime,
        avg_cycle_time_trend: avgCycleTimeTrend,
        sprint_predictability_score: sprintPredictabilityScore,
        longest_open_tasks: longestOpenTasks,
        review_bottleneck: reviewBottleneck,
      },
      risk_audit: {
        section_score: riskSectionScore,
        section_status: statusFromScore(riskSectionScore),
        active_blockers: activeBlockers,
        avg_blocker_resolution_time: avgBlockerResolutionTime,
        recurring_blockers: recurringBlockers,
        dependency_risks: dependencyRisks,
        at_risk_tasks: atRiskTasks,
        team_bandwidth_risk: teamBandwidthRisk,
      },
      process_audit: {
        section_score: processSectionScore,
        section_status: statusFromScore(processSectionScore),
        tasks_without_estimates: {
          count: tasksWithoutEstimates.length,
          tasks: tasksWithoutEstimates,
        },
        tasks_reassigned: tasksReassigned,
        late_starts: lateStarts,
        definition_of_done_compliance: {
          non_compliant_tasks: definitionOfDoneCompliance,
        },
        standup_anomalies: standupAnomalies,
        avg_tasks_per_developer: {
          value: avgTasksPerDeveloper,
          equitable,
          max_tasks: maxTasks,
          min_tasks: minTasks,
        },
      },
      recommendations: {
        section_score: recommendationsSectionScore,
        section_status: statusFromScore(recommendationsSectionScore),
        top_3_immediate_actions: aiInsights.priority_actions || [
          'Resolve active blockers older than 2 days and assign explicit owners with ETA.',
          'Re-scope or split carry-over-risk tasks before sprint end to protect predictability.',
          'Redistribute overloaded developer workload to underutilised contributors this sprint.',
        ],
        top_3_process_improvements: [
          'Enforce estimate and acceptance-criteria checks before items move to sprint-ready.',
          'Introduce mid-sprint assignment review for mismatch and reassignment reduction.',
          'Track stale in-progress tasks daily and escalate after 3 days without updates.',
        ],
        hiring_or_training_recommendation: skillGap.length
          ? `Prioritize hiring or upskilling in: ${skillGap.join(', ')}.`
          : 'Focus on cross-training to reduce bus factor for single-owner skills.',
        next_sprint_readiness_score: nextSprintReadinessScore,
        executive_summary: `Sprint ${sprint.name} delivered ${completionRate}% of committed points with ${overdueTasks.length} overdue tasks and ${scopeCreep.length} scope additions. Delivery predictability is ${Math.round(sprintPredictabilityScore)}%, while velocity trend is ${velocityStability}. Backlog health shows ${missingStoryPoints.length} items without estimates and ${Math.round(ungroomedPercentage)}% ungroomed work, reducing readiness. Developer analysis flagged ${overloadedDevelopers.length} overloaded and ${underutilisedDevelopers.length} underutilised contributors, with ${taskMismatch.length} skill mismatches. Risk posture includes ${activeBlockers.length} active blockers and ${atRiskTasks.length} tasks with low recent activity. Immediate focus should be blocker resolution, workload balancing, and stricter backlog readiness gates before the next sprint.`,
        ai_summary: aiInsights.executive_summary || null,
        ai_skill_focus: Array.isArray(aiInsights.skills_focus) ? aiInsights.skills_focus : [],
        ai_bench_actions: Array.isArray(aiInsights.bench_developer_actions) ? aiInsights.bench_developer_actions : [],
        ai_notes: Array.isArray(aiInsights.notes) ? aiInsights.notes : [],
      },
    };

    return res.status(200).json(response);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listReports,
  getSprintReport,
  getSprintAuditReport,
  exportSprintReportCsv,
};
