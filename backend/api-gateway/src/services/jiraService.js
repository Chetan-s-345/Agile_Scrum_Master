const axios = require('axios');

const { logger } = require('../middleware/logger');

function normalizeBaseUrl(baseUrl) {
  const u = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!u) throw Object.assign(new Error('baseUrl is required'), { statusCode: 400 });
  return u;
}

function encodeBasicAuth(email, apiToken) {
  const value = `${String(email)}:${String(apiToken)}`;
  return Buffer.from(value, 'utf8').toString('base64');
}

function safeText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value);
  return s.length ? s : null;
}

function pickStoryPoints(fields, storyPointsField) {
  if (!fields) return null;
  if (storyPointsField && fields[storyPointsField] != null) return Number(fields[storyPointsField]);
  // Common default in Jira Cloud team-managed/next-gen
  if (fields.customfield_10016 != null) return Number(fields.customfield_10016);
  // Fallback to null
  return null;
}

function mapJiraStatusToTaskStatus(issue) {
  const cat = issue?.fields?.status?.statusCategory?.key;
  if (cat === 'done') return 'done';
  if (cat === 'new') return 'todo';
  if (cat === 'indeterminate') return 'in_progress';
  return 'todo';
}

function mapJiraPriority(priority) {
  const name = String(priority?.name || '').toLowerCase();
  if (name.includes('highest') || name.includes('critical')) return 'critical';
  if (name.includes('high')) return 'high';
  if (name.includes('low') || name.includes('lowest')) return 'low';
  return 'medium';
}

function toJqlDateUtc(value) {
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  // Jira JQL accepts this format in most cloud tenants.
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

class JiraService {
  constructor() {
    this.http = axios.create({
      timeout: 30_000,
      maxBodyLength: 10 * 1024 * 1024,
    });
  }

  async connect({ baseUrl, email, apiToken, projectKey, boardId, storyPointsField }, orgPool) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const normalizedProjectKey = String(projectKey || '').trim();
    if (!normalizedProjectKey) throw Object.assign(new Error('projectKey is required'), { statusCode: 400 });

    const normalizedEmail = String(email || '').trim();
    const normalizedToken = String(apiToken || '').trim();
    if (!normalizedEmail || !normalizedToken) throw Object.assign(new Error('email and apiToken are required'), { statusCode: 400 });

    const authHeader = `Basic ${encodeBasicAuth(normalizedEmail, normalizedToken)}`;

    // Validate creds
    const meResp = await this.http.get(`${normalizedBaseUrl}/rest/api/3/myself`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });

    const identity = {
      accountId: meResp.data?.accountId || null,
      displayName: meResp.data?.displayName || null,
      emailAddress: meResp.data?.emailAddress || null,
    };

    let projectName = null;
    let issueCount = null;
    try {
      const projectResp = await this.http.get(`${normalizedBaseUrl}/rest/api/3/project/${encodeURIComponent(normalizedProjectKey)}`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
      });
      projectName = projectResp.data?.name ? String(projectResp.data.name) : null;
    } catch {
      projectName = null;
    }

    try {
      const countResp = await this.http.get(`${normalizedBaseUrl}/rest/api/3/search`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
        params: { jql: `project = ${normalizedProjectKey}`, maxResults: 0 },
      });
      issueCount = Number.isFinite(Number(countResp.data?.total)) ? Number(countResp.data.total) : null;
    } catch {
      issueCount = null;
    }

    const tokenPayload = {
      email: normalizedEmail,
      apiToken: normalizedToken,
    };

    const mappings = {
      ...(storyPointsField ? { storyPointsField: String(storyPointsField) } : {}),
      ...(boardId ? { boardId: String(boardId) } : {}),
    };

    // Upsert-style: keep a single active row
    await orgPool.query('BEGIN');
    try {
      const existing = await orgPool.query('SELECT id FROM jira_integration ORDER BY created_at ASC LIMIT 1');
      if (existing.rows.length) {
        await orgPool.query(
          `UPDATE jira_integration
           SET base_url = $1,
               project_key = $2,
               auth_type = 'api_token',
               api_token_encrypted = $3,
               is_active = TRUE,
               sync_status = 'idle',
               sync_error = NULL,
               field_mappings = COALESCE(field_mappings, '{}'::jsonb) || $4::jsonb,
               updated_at = NOW()
           WHERE id = $5`,
          [
            normalizedBaseUrl,
            normalizedProjectKey,
            JSON.stringify(tokenPayload),
            JSON.stringify(mappings),
            String(existing.rows[0].id),
          ]
        );
      } else {
        await orgPool.query(
          `INSERT INTO jira_integration (base_url, project_key, auth_type, api_token_encrypted, is_active, field_mappings)
           VALUES ($1,$2,'api_token',$3,TRUE,$4::jsonb)`,
          [normalizedBaseUrl, normalizedProjectKey, JSON.stringify(tokenPayload), JSON.stringify(mappings)]
        );
      }

      await orgPool.query('COMMIT');
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }

    return { connected: true, identity, projectName, issueCount };
  }

  async getIntegration(orgPool) {
    const resp = await orgPool.query('SELECT * FROM jira_integration WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
    return resp.rows[0] || null;
  }

  async _getAuthHeader(orgPool) {
    const integ = await this.getIntegration(orgPool);
    if (!integ) throw Object.assign(new Error('Jira integration not configured'), { statusCode: 400 });

    const baseUrl = normalizeBaseUrl(integ.base_url);

    let tokenPayload = null;
    try {
      tokenPayload = integ.api_token_encrypted ? JSON.parse(String(integ.api_token_encrypted)) : null;
    } catch {
      tokenPayload = null;
    }

    const email = tokenPayload?.email;
    const apiToken = tokenPayload?.apiToken;
    if (!email || !apiToken) throw Object.assign(new Error('Jira credentials missing'), { statusCode: 400 });

    const authHeader = `Basic ${encodeBasicAuth(email, apiToken)}`;

    const fieldMappings = integ.field_mappings || {};

    return { baseUrl, authHeader, projectKey: integ.project_key, fieldMappings };
  }

  async listProjects(orgPool) {
    const { baseUrl, authHeader } = await this._getAuthHeader(orgPool);

    const resp = await this.http.get(`${baseUrl}/rest/api/3/project/search`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      params: { maxResults: 50, orderBy: 'name' },
    });

    const values = Array.isArray(resp.data?.values) ? resp.data.values : [];
    return values
      .map((p) => ({
        id: safeText(p?.id),
        key: safeText(p?.key),
        name: safeText(p?.name),
      }))
      .filter((p) => p.key);
  }

  async listBoards(orgPool) {
    const { baseUrl, authHeader } = await this._getAuthHeader(orgPool);

    const resp = await this.http.get(`${baseUrl}/rest/agile/1.0/board`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      params: { maxResults: 50 },
    });

    const values = Array.isArray(resp.data?.values) ? resp.data.values : [];
    return values
      .map((b) => ({
        id: safeText(b?.id),
        name: safeText(b?.name),
        type: safeText(b?.type),
        projectKey: safeText(b?.location?.projectKey) || safeText(b?.location?.project?.key) || null,
      }))
      .filter((b) => b.id);
  }

  async syncProject(orgPool, { projectKey, boardId, mode, since, onProgress }) {
    const { baseUrl, authHeader, fieldMappings } = await this._getAuthHeader(orgPool);
    const key = safeText(projectKey);
    if (!key) throw Object.assign(new Error('projectKey is required'), { statusCode: 400 });

    const storyPointsField = fieldMappings?.storyPointsField;
    const normalizedMode = String(mode || 'incremental');

    // Backlog search (sprint empty) for incremental/full.
    let backlogIssues = [];
    if (normalizedMode !== 'active_sprint') {
      const updatedClause =
        normalizedMode === 'full_30d'
          ? 'updated >= -30d'
          : since
            ? `updated >= "${toJqlDateUtc(since)}"`
            : 'updated >= -7d';

      const jql = `project = ${key} AND sprint is EMPTY AND ${updatedClause} ORDER BY updated DESC`;
      const countResp = await this.http.get(`${baseUrl}/rest/api/3/search`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
        params: { jql, maxResults: 0 },
      });

      const total = Number(countResp.data?.total || 0) || 0;
      let processed = 0;
      const pageSize = 50;
      for (let startAt = 0; startAt < total; startAt += pageSize) {
        const page = await this.http.get(`${baseUrl}/rest/api/3/search`, {
          headers: { Authorization: authHeader, Accept: 'application/json' },
          params: {
            jql,
            startAt,
            maxResults: pageSize,
            fields: [
              'summary',
              'description',
              'issuetype',
              'priority',
              'labels',
              'updated',
              'created',
              'status',
              storyPointsField || 'customfield_10016',
            ].filter(Boolean).join(','),
          },
        });

        const issues = Array.isArray(page.data?.issues) ? page.data.issues : [];
        backlogIssues = backlogIssues.concat(issues);
        processed += issues.length;
        if (typeof onProgress === 'function') onProgress({ processed, total, phase: 'backlog' });
      }
    }

    // Active sprint issues for board-driven modes.
    let sprintIssues = [];
    if (boardId || normalizedMode === 'active_sprint') {
      const bId = safeText(boardId);
      if (normalizedMode === 'active_sprint' && !bId) {
        throw Object.assign(new Error('boardId is required for active sprint only'), { statusCode: 400 });
      }

      if (bId) {
        const sprintResp = await this.http.get(`${baseUrl}/rest/agile/1.0/board/${encodeURIComponent(bId)}/sprint`, {
          headers: { Authorization: authHeader, Accept: 'application/json' },
          params: { state: 'active', maxResults: 1 },
        });

        const sprint = Array.isArray(sprintResp.data?.values) ? sprintResp.data.values[0] : null;
        if (sprint) {
          const jiraSprintId = safeText(sprint.id);
          const issuesCountResp = await this.http.get(`${baseUrl}/rest/agile/1.0/sprint/${encodeURIComponent(jiraSprintId)}/issue`, {
            headers: { Authorization: authHeader, Accept: 'application/json' },
            params: { maxResults: 0 },
          });

          const total = Number(issuesCountResp.data?.total || 0) || 0;
          let processed = 0;
          const pageSize = 50;
          for (let startAt = 0; startAt < total; startAt += pageSize) {
            const page = await this.http.get(`${baseUrl}/rest/agile/1.0/sprint/${encodeURIComponent(jiraSprintId)}/issue`, {
              headers: { Authorization: authHeader, Accept: 'application/json' },
              params: {
                startAt,
                maxResults: pageSize,
                fields: [
                  'summary',
                  'description',
                  'issuetype',
                  'priority',
                  'labels',
                  'status',
                  storyPointsField || 'customfield_10016',
                ].filter(Boolean).join(','),
              },
            });

            const issues = Array.isArray(page.data?.issues) ? page.data.issues : [];
            sprintIssues = sprintIssues.concat(issues);
            processed += issues.length;
            if (typeof onProgress === 'function') onProgress({ processed, total, phase: 'active_sprint' });
          }
        }
      }
    }

    return { backlogIssues, sprintIssues };
  }

  async syncBacklog(orgPool) {
    const { baseUrl, authHeader, projectKey, fieldMappings } = await this._getAuthHeader(orgPool);

    const storyPointsField = fieldMappings?.storyPointsField;

    const jql = `project = ${projectKey} AND sprint is EMPTY ORDER BY updated DESC`;
    const searchResp = await this.http.get(`${baseUrl}/rest/api/3/search`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      params: {
        jql,
        maxResults: 50,
        fields: [
          'summary',
          'description',
          'issuetype',
          'priority',
          'labels',
          'updated',
          'created',
          'status',
          storyPointsField || 'customfield_10016',
        ].filter(Boolean).join(','),
      },
    });

    const issues = Array.isArray(searchResp.data?.issues) ? searchResp.data.issues : [];

    const projectResp = await orgPool.query('SELECT id FROM projects WHERE jira_project_key = $1 LIMIT 1', [String(projectKey)]);
    const projectId = projectResp.rows[0]?.id;
    if (!projectId) {
      throw Object.assign(new Error('No local project found matching jira_project_key'), { statusCode: 400 });
    }

    let ok = 0;
    let failed = 0;
    const errors = [];

    for (const issue of issues) {
      try {
        const jiraIssueId = safeText(issue?.id);
        const jiraIssueKey = safeText(issue?.key);
        const fields = issue?.fields || {};

        const title = safeText(fields.summary) || jiraIssueKey || 'Untitled';
        const description = safeText(fields.description?.content ? JSON.stringify(fields.description) : fields.description) || null;
        const type = safeText(fields.issuetype?.name)?.toLowerCase() || 'story';
        const priority = mapJiraPriority(fields.priority);
        const labels = Array.isArray(fields.labels) ? fields.labels : [];
        const storyPoints = pickStoryPoints(fields, storyPointsField);

        // Upsert by jira_issue_id
        await orgPool.query(
          `INSERT INTO backlog_items (project_id, title, description, type, priority, status, story_points, tech_tags, jira_issue_id, jira_issue_key)
           VALUES ($1,$2,$3,$4,$5,'backlog',$6,$7,$8,$9)
           ON CONFLICT (jira_issue_id) DO UPDATE SET
             project_id = EXCLUDED.project_id,
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             type = EXCLUDED.type,
             priority = EXCLUDED.priority,
             story_points = EXCLUDED.story_points,
             tech_tags = EXCLUDED.tech_tags,
             jira_issue_key = EXCLUDED.jira_issue_key,
             updated_at = NOW()`,
          [
            String(projectId),
            String(title),
            description,
            String(type),
            String(priority),
            storyPoints != null && Number.isFinite(Number(storyPoints)) ? Math.round(Number(storyPoints)) : null,
            labels,
            jiraIssueId,
            jiraIssueKey,
          ]
        );

        ok += 1;
      } catch (e) {
        failed += 1;
        errors.push({ issueKey: issue?.key, error: String(e?.message || e) });
      }
    }

    await orgPool.query(
      `INSERT INTO jira_sync_log (sync_type, direction, records_synced, records_failed, status, error_details, completed_at)
       VALUES ('full_sync','inbound',$1,$2,$3,$4::jsonb,NOW())`,
      [ok, failed, failed ? (ok ? 'partial' : 'failed') : 'success', JSON.stringify(errors)]
    );

    return { ok, failed, errors };
  }

  async countBacklogIssues(orgPool, { projectKey, mode, since } = {}) {
    const { baseUrl, authHeader } = await this._getAuthHeader(orgPool);
    const key = safeText(projectKey);
    if (!key) throw Object.assign(new Error('projectKey is required'), { statusCode: 400 });

    const normalizedMode = String(mode || 'incremental');
    const updatedClause =
      normalizedMode === 'full_30d'
        ? 'updated >= -30d'
        : since
          ? `updated >= "${toJqlDateUtc(since)}"`
          : 'updated >= -7d';

    const jql = `project = ${key} AND sprint is EMPTY AND ${updatedClause}`;
    const resp = await this.http.get(`${baseUrl}/rest/api/3/search`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      params: { jql, maxResults: 0 },
    });
    return Number(resp.data?.total || 0) || 0;
  }

  async syncBacklogFor(orgPool, { projectKey, mode, since, onProgress } = {}) {
    const { baseUrl, authHeader, fieldMappings } = await this._getAuthHeader(orgPool);
    const key = safeText(projectKey);
    if (!key) throw Object.assign(new Error('projectKey is required'), { statusCode: 400 });

    const normalizedMode = String(mode || 'incremental');
    const storyPointsField = fieldMappings?.storyPointsField;

    const updatedClause =
      normalizedMode === 'full_30d'
        ? 'updated >= -30d'
        : since
          ? `updated >= "${toJqlDateUtc(since)}"`
          : 'updated >= -7d';

    const jql = `project = ${key} AND sprint is EMPTY AND ${updatedClause} ORDER BY updated DESC`;

    const total = await this.countBacklogIssues(orgPool, { projectKey: key, mode: normalizedMode, since });
    const projectResp = await orgPool.query('SELECT id FROM projects WHERE jira_project_key = $1 LIMIT 1', [String(key)]);
    const projectId = projectResp.rows[0]?.id;
    if (!projectId) {
      throw Object.assign(new Error('No local project found matching jira_project_key'), { statusCode: 400 });
    }

    let ok = 0;
    let failed = 0;
    const errors = [];

    const pageSize = 50;
    for (let startAt = 0; startAt < total; startAt += pageSize) {
      const searchResp = await this.http.get(`${baseUrl}/rest/api/3/search`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
        params: {
          jql,
          startAt,
          maxResults: pageSize,
          fields: [
            'summary',
            'description',
            'issuetype',
            'priority',
            'labels',
            'updated',
            'created',
            'status',
            storyPointsField || 'customfield_10016',
          ].filter(Boolean).join(','),
        },
      });

      const issues = Array.isArray(searchResp.data?.issues) ? searchResp.data.issues : [];

      for (const issue of issues) {
        try {
          const jiraIssueId = safeText(issue?.id);
          const jiraIssueKey = safeText(issue?.key);
          const fields = issue?.fields || {};

          const title = safeText(fields.summary) || jiraIssueKey || 'Untitled';
          const description = safeText(fields.description?.content ? JSON.stringify(fields.description) : fields.description) || null;
          const type = safeText(fields.issuetype?.name)?.toLowerCase() || 'story';
          const priority = mapJiraPriority(fields.priority);
          const labels = Array.isArray(fields.labels) ? fields.labels : [];
          const storyPoints = pickStoryPoints(fields, storyPointsField);

          await orgPool.query(
            `INSERT INTO backlog_items (project_id, title, description, type, priority, status, story_points, tech_tags, jira_issue_id, jira_issue_key)
             VALUES ($1,$2,$3,$4,$5,'backlog',$6,$7,$8,$9)
             ON CONFLICT (jira_issue_id) DO UPDATE SET
               project_id = EXCLUDED.project_id,
               title = EXCLUDED.title,
               description = EXCLUDED.description,
               type = EXCLUDED.type,
               priority = EXCLUDED.priority,
               story_points = EXCLUDED.story_points,
               tech_tags = EXCLUDED.tech_tags,
               jira_issue_key = EXCLUDED.jira_issue_key,
               updated_at = NOW()`,
            [
              String(projectId),
              String(title),
              description,
              String(type),
              String(priority),
              storyPoints != null && Number.isFinite(Number(storyPoints)) ? Math.round(Number(storyPoints)) : null,
              labels,
              jiraIssueId,
              jiraIssueKey,
            ]
          );

          ok += 1;
        } catch (e) {
          failed += 1;
          errors.push({ issueKey: issue?.key, error: String(e?.message || e) });
        }

        if (typeof onProgress === 'function') onProgress({ processed: ok + failed, total, phase: 'backlog' });
      }
    }

    return { ok, failed, errors };
  }

  async syncActiveSprint(orgPool) {
    const { baseUrl, authHeader, projectKey, fieldMappings } = await this._getAuthHeader(orgPool);

    const boardId = fieldMappings?.boardId;
    if (!boardId) {
      throw Object.assign(new Error('boardId is required to sync active sprint (configure it during connect)'), { statusCode: 400 });
    }

    const storyPointsField = fieldMappings?.storyPointsField;

    // Get active sprint
    const sprintResp = await this.http.get(`${baseUrl}/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      params: { state: 'active', maxResults: 1 },
    });

    const sprint = Array.isArray(sprintResp.data?.values) ? sprintResp.data.values[0] : null;
    if (!sprint) return { ok: 0, failed: 0, errors: [], sprint: null };

    const jiraSprintId = safeText(sprint.id);
    const sprintName = safeText(sprint.name) || 'Jira Sprint';

    const projectResp = await orgPool.query('SELECT id FROM projects WHERE jira_project_key = $1 LIMIT 1', [String(projectKey)]);
    const projectId = projectResp.rows[0]?.id;
    if (!projectId) {
      throw Object.assign(new Error('No local project found matching jira_project_key'), { statusCode: 400 });
    }

    // Upsert sprint by jira_sprint_id
    const existingSprintResp = await orgPool.query('SELECT id FROM sprints WHERE jira_sprint_id = $1 LIMIT 1', [jiraSprintId]);
    let sprintId = existingSprintResp.rows[0]?.id;

    if (!sprintId) {
      const nextNumberResp = await orgPool.query('SELECT COALESCE(MAX(sprint_number), 0)::int AS n FROM sprints WHERE project_id = $1', [String(projectId)]);
      const sprintNumber = Number(nextNumberResp.rows[0]?.n || 0) + 1;

      const startDate = sprint.startDate ? String(sprint.startDate).slice(0, 10) : null;
      const endDate = sprint.endDate ? String(sprint.endDate).slice(0, 10) : null;

      const insertResp = await orgPool.query(
        `INSERT INTO sprints (project_id, name, sprint_number, start_date, end_date, status, jira_sprint_id)
         VALUES ($1,$2,$3,$4::date,$5::date,'active',$6)
         RETURNING id`,
        [String(projectId), sprintName, sprintNumber, startDate, endDate, jiraSprintId]
      );
      sprintId = insertResp.rows[0]?.id;
    }

    const issuesResp = await this.http.get(`${baseUrl}/rest/agile/1.0/sprint/${encodeURIComponent(jiraSprintId)}/issue`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      params: {
        maxResults: 200,
        fields: [
          'summary',
          'description',
          'issuetype',
          'priority',
          'labels',
          'status',
          storyPointsField || 'customfield_10016',
        ].filter(Boolean).join(','),
      },
    });

    const issues = Array.isArray(issuesResp.data?.issues) ? issuesResp.data.issues : [];

    let ok = 0;
    let failed = 0;
    const errors = [];

    for (const issue of issues) {
      try {
        const jiraIssueId = safeText(issue?.id);
        const jiraIssueKey = safeText(issue?.key);
        const fields = issue?.fields || {};

        const title = safeText(fields.summary) || jiraIssueKey || 'Untitled';
        const description = safeText(fields.description?.content ? JSON.stringify(fields.description) : fields.description) || null;
        const type = safeText(fields.issuetype?.name)?.toLowerCase() || 'task';
        const priority = mapJiraPriority(fields.priority);
        const labels = Array.isArray(fields.labels) ? fields.labels : [];
        const storyPoints = pickStoryPoints(fields, storyPointsField);
        const status = mapJiraStatusToTaskStatus(issue);

        await orgPool.query(
          `INSERT INTO tasks (sprint_id, project_id, title, description, type, status, priority, story_points, tech_tags, jira_issue_id, jira_issue_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (jira_issue_id) DO UPDATE SET
             sprint_id = EXCLUDED.sprint_id,
             project_id = EXCLUDED.project_id,
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             type = EXCLUDED.type,
             status = EXCLUDED.status,
             priority = EXCLUDED.priority,
             story_points = EXCLUDED.story_points,
             tech_tags = EXCLUDED.tech_tags,
             jira_issue_key = EXCLUDED.jira_issue_key,
             updated_at = NOW()`,
          [
            String(sprintId),
            String(projectId),
            String(title),
            description,
            String(type),
            String(status),
            String(priority),
            storyPoints != null && Number.isFinite(Number(storyPoints)) ? Math.round(Number(storyPoints)) : 0,
            labels,
            jiraIssueId,
            jiraIssueKey,
          ]
        );

        ok += 1;
      } catch (e) {
        failed += 1;
        errors.push({ issueKey: issue?.key, error: String(e?.message || e) });
      }
    }

    await orgPool.query(
      `INSERT INTO jira_sync_log (sync_type, direction, records_synced, records_failed, status, error_details, completed_at)
       VALUES ('incremental','inbound',$1,$2,$3,$4::jsonb,NOW())`,
      [ok, failed, failed ? (ok ? 'partial' : 'failed') : 'success', JSON.stringify(errors)]
    );

    return { ok, failed, errors, sprint: { jiraSprintId, sprintId } };
  }

  async countActiveSprintIssues(orgPool, { boardId } = {}) {
    const { baseUrl, authHeader } = await this._getAuthHeader(orgPool);
    const bId = safeText(boardId);
    if (!bId) throw Object.assign(new Error('boardId is required'), { statusCode: 400 });

    const sprintResp = await this.http.get(`${baseUrl}/rest/agile/1.0/board/${encodeURIComponent(bId)}/sprint`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      params: { state: 'active', maxResults: 1 },
    });

    const sprint = Array.isArray(sprintResp.data?.values) ? sprintResp.data.values[0] : null;
    if (!sprint) return { total: 0, jiraSprintId: null, sprintName: null };

    const jiraSprintId = safeText(sprint.id);
    const sprintName = safeText(sprint.name) || 'Jira Sprint';

    const countResp = await this.http.get(`${baseUrl}/rest/agile/1.0/sprint/${encodeURIComponent(jiraSprintId)}/issue`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      params: { maxResults: 0 },
    });

    return { total: Number(countResp.data?.total || 0) || 0, jiraSprintId, sprintName };
  }

  async syncActiveSprintFor(orgPool, { projectKey, boardId, onProgress } = {}) {
    const { baseUrl, authHeader, fieldMappings } = await this._getAuthHeader(orgPool);

    const key = safeText(projectKey);
    const bId = safeText(boardId);
    if (!key) throw Object.assign(new Error('projectKey is required'), { statusCode: 400 });
    if (!bId) throw Object.assign(new Error('boardId is required'), { statusCode: 400 });

    const storyPointsField = fieldMappings?.storyPointsField;

    const sprintInfo = await this.countActiveSprintIssues(orgPool, { boardId: bId });
    if (!sprintInfo.jiraSprintId) return { ok: 0, failed: 0, errors: [], sprint: null };

    const projectResp = await orgPool.query('SELECT id FROM projects WHERE jira_project_key = $1 LIMIT 1', [String(key)]);
    const projectId = projectResp.rows[0]?.id;
    if (!projectId) {
      throw Object.assign(new Error('No local project found matching jira_project_key'), { statusCode: 400 });
    }

    const existingSprintResp = await orgPool.query('SELECT id FROM sprints WHERE jira_sprint_id = $1 LIMIT 1', [String(sprintInfo.jiraSprintId)]);
    let sprintId = existingSprintResp.rows[0]?.id;

    if (!sprintId) {
      const nextNumberResp = await orgPool.query('SELECT COALESCE(MAX(sprint_number), 0)::int AS n FROM sprints WHERE project_id = $1', [String(projectId)]);
      const sprintNumber = Number(nextNumberResp.rows[0]?.n || 0) + 1;

      const insertResp = await orgPool.query(
        `INSERT INTO sprints (project_id, name, sprint_number, start_date, end_date, status, jira_sprint_id)
         VALUES ($1,$2,$3,NULL,NULL,'active',$4)
         RETURNING id`,
        [String(projectId), String(sprintInfo.sprintName || 'Jira Sprint'), sprintNumber, String(sprintInfo.jiraSprintId)]
      );
      sprintId = insertResp.rows[0]?.id;
    }

    const total = Number(sprintInfo.total || 0) || 0;
    const pageSize = 50;
    let ok = 0;
    let failed = 0;
    const errors = [];

    for (let startAt = 0; startAt < total; startAt += pageSize) {
      const issuesResp = await this.http.get(`${baseUrl}/rest/agile/1.0/sprint/${encodeURIComponent(sprintInfo.jiraSprintId)}/issue`, {
        headers: { Authorization: authHeader, Accept: 'application/json' },
        params: {
          startAt,
          maxResults: pageSize,
          fields: [
            'summary',
            'description',
            'issuetype',
            'priority',
            'labels',
            'status',
            storyPointsField || 'customfield_10016',
          ].filter(Boolean).join(','),
        },
      });

      const issues = Array.isArray(issuesResp.data?.issues) ? issuesResp.data.issues : [];
      for (const issue of issues) {
        try {
          const jiraIssueId = safeText(issue?.id);
          const jiraIssueKey = safeText(issue?.key);
          const fields = issue?.fields || {};

          const title = safeText(fields.summary) || jiraIssueKey || 'Untitled';
          const description = safeText(fields.description?.content ? JSON.stringify(fields.description) : fields.description) || null;
          const type = safeText(fields.issuetype?.name)?.toLowerCase() || 'task';
          const priority = mapJiraPriority(fields.priority);
          const labels = Array.isArray(fields.labels) ? fields.labels : [];
          const storyPoints = pickStoryPoints(fields, storyPointsField);
          const status = mapJiraStatusToTaskStatus(issue);

          await orgPool.query(
            `INSERT INTO tasks (sprint_id, project_id, title, description, type, status, priority, story_points, tech_tags, jira_issue_id, jira_issue_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (jira_issue_id) DO UPDATE SET
               sprint_id = EXCLUDED.sprint_id,
               project_id = EXCLUDED.project_id,
               title = EXCLUDED.title,
               description = EXCLUDED.description,
               type = EXCLUDED.type,
               status = EXCLUDED.status,
               priority = EXCLUDED.priority,
               story_points = EXCLUDED.story_points,
               tech_tags = EXCLUDED.tech_tags,
               jira_issue_key = EXCLUDED.jira_issue_key,
               updated_at = NOW()`,
            [
              String(sprintId),
              String(projectId),
              String(title),
              description,
              String(type),
              String(status),
              String(priority),
              storyPoints != null && Number.isFinite(Number(storyPoints)) ? Math.round(Number(storyPoints)) : 0,
              labels,
              jiraIssueId,
              jiraIssueKey,
            ]
          );

          ok += 1;
        } catch (e) {
          failed += 1;
          errors.push({ issueKey: issue?.key, error: String(e?.message || e) });
        }

        if (typeof onProgress === 'function') onProgress({ processed: ok + failed, total, phase: 'active_sprint' });
      }
    }

    return { ok, failed, errors, sprint: { jiraSprintId: sprintInfo.jiraSprintId, sprintId } };
  }

  async createIssue(taskData, orgPool) {
    const { baseUrl, authHeader, projectKey, fieldMappings } = await this._getAuthHeader(orgPool);

    const taskId = safeText(taskData?.taskId);
    const summary = safeText(taskData?.summary || taskData?.title);
    const description = taskData?.description ?? null;
    const issuetype = safeText(taskData?.issuetype || taskData?.type) || 'Task';
    const priority = safeText(taskData?.priority) || 'Medium';
    const explicitStoryPoints = taskData?.storyPoints ?? taskData?.story_points;
    let storyPoints = explicitStoryPoints;
    const aiEstimated = taskData?.aiEstimatedPoints ?? taskData?.ai_estimated_points;
    if ((storyPoints === undefined || storyPoints === null || Number(storyPoints) === 0) && aiEstimated !== undefined && aiEstimated !== null && Number(aiEstimated) > 0) {
      storyPoints = aiEstimated;
    }
    const projectKeyOverride = safeText(taskData?.projectKey) || null;

    if (!summary) throw Object.assign(new Error('summary is required'), { statusCode: 400 });

    const storyPointsField = fieldMappings?.storyPointsField || 'customfield_10016';

    const body = {
      fields: {
        project: { key: projectKeyOverride || projectKey },
        summary,
        description,
        issuetype: { name: issuetype },
        priority: { name: priority },
        ...(storyPoints != null ? { [storyPointsField]: Number(storyPoints) } : {}),
      },
    };

    const resp = await this.http.post(`${baseUrl}/rest/api/3/issue`, body, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });

    const jiraIssueId = safeText(resp.data?.id);
    const jiraIssueKey = safeText(resp.data?.key);

    if (taskId && (jiraIssueId || jiraIssueKey)) {
      await orgPool.query(
        `UPDATE tasks
         SET jira_issue_id = COALESCE($2, jira_issue_id),
             jira_issue_key = COALESCE($3, jira_issue_key),
             updated_at = NOW()
         WHERE id = $1`,
        [taskId, jiraIssueId, jiraIssueKey]
      );
    }

    return { ok: true, jiraIssueId, jiraIssueKey };
  }

  async updateAssignee(jiraIssueId, jiraAccountId, orgPool) {
    const { baseUrl, authHeader } = await this._getAuthHeader(orgPool);

    const issueId = safeText(jiraIssueId);
    const accountId = safeText(jiraAccountId);
    if (!issueId || !accountId) throw Object.assign(new Error('jiraIssueId and jiraAccountId are required'), { statusCode: 400 });

    await this.http.put(
      `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueId)}/assignee`,
      { accountId },
      { headers: { Authorization: authHeader, Accept: 'application/json' } }
    );

    return { ok: true };
  }

  async updateStatusByName(jiraIssueIdOrKey, statusName, orgPool) {
    const { baseUrl, authHeader } = await this._getAuthHeader(orgPool);

    const issueIdOrKey = safeText(jiraIssueIdOrKey);
    const desired = safeText(statusName);
    if (!issueIdOrKey || !desired) {
      throw Object.assign(new Error('jiraIssueIdOrKey and statusName are required'), { statusCode: 400 });
    }

    const resp = await this.http.get(
      `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/transitions`,
      { headers: { Authorization: authHeader, Accept: 'application/json' } }
    );

    const transitions = Array.isArray(resp.data?.transitions) ? resp.data.transitions : [];
    const desiredLc = String(desired).toLowerCase();

    const match = transitions.find((t) => {
      const name = String(t?.name || '').toLowerCase();
      const toName = String(t?.to?.name || '').toLowerCase();
      return name === desiredLc || toName === desiredLc;
    });

    const transitionId = safeText(match?.id);
    if (!transitionId) {
      throw Object.assign(
        new Error(`No Jira transition found for status: ${desired}`),
        { statusCode: 400 }
      );
    }

    return await this.updateStatus(issueIdOrKey, transitionId, orgPool);
  }

  async updateStatus(jiraIssueId, transitionId, orgPool) {
    const { baseUrl, authHeader } = await this._getAuthHeader(orgPool);

    const issueId = safeText(jiraIssueId);
    const transition = safeText(transitionId);
    if (!issueId || !transition) throw Object.assign(new Error('jiraIssueId and transitionId are required'), { statusCode: 400 });

    await this.http.post(
      `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueId)}/transitions`,
      { transition: { id: transition } },
      { headers: { Authorization: authHeader, Accept: 'application/json' } }
    );

    return { ok: true };
  }

  async moveToSprint(jiraIssueId, jiraSprintId, orgPool) {
    const { baseUrl, authHeader } = await this._getAuthHeader(orgPool);

    const issueId = safeText(jiraIssueId);
    const sprintId = safeText(jiraSprintId);
    if (!issueId || !sprintId) throw Object.assign(new Error('jiraIssueId and jiraSprintId are required'), { statusCode: 400 });

    await this.http.post(
      `${baseUrl}/rest/agile/1.0/sprint/${encodeURIComponent(sprintId)}/issue`,
      { issues: [issueId] },
      { headers: { Authorization: authHeader, Accept: 'application/json' } }
    );

    return { ok: true };
  }

  async getStatus(orgPool) {
    const base = {
      connected: false,
      baseUrl: null,
      projectKey: null,
      lastSyncAt: null,
      syncStatus: null,
      syncError: null,
      fieldMappings: {},
      totalSynced: null,
      totalFailed: null,
      pendingSync: null,
      lastWebhookReceivedAt: null,
      lastWebhookEvent: null,
      recentSyncLogs: null,
    };

    let integ = null;
    try {
      integ = await this.getIntegration(orgPool);
    } catch {
      integ = null;
    }

    if (!integ) {
      // Not connected: return full shape with null aggregates.
      return base;
    }

    const connected = Boolean(integ.is_active);
    if (!connected) {
      return {
        ...base,
        connected: false,
        baseUrl: integ.base_url || null,
        projectKey: integ.project_key || null,
        lastSyncAt: integ.last_sync_at || null,
        syncStatus: integ.sync_status || null,
        syncError: integ.sync_error || null,
        fieldMappings: integ.field_mappings || {},
      };
    }

    const out = {
      ...base,
      connected: true,
      baseUrl: integ.base_url || null,
      projectKey: integ.project_key || null,
      lastSyncAt: integ.last_sync_at || null,
      syncStatus: integ.sync_status || null,
      syncError: integ.sync_error || null,
      fieldMappings: integ.field_mappings || {},
    };

    // Aggregations are best-effort; avoid breaking status endpoint if a table/column is missing.
    try {
      const counts = await orgPool.query(
        `SELECT
           COUNT(*) FILTER (WHERE jira_synced IS TRUE)::int AS total_synced,
           COUNT(*) FILTER (WHERE jira_synced IS FALSE)::int AS total_failed,
           COUNT(*) FILTER (
             WHERE jira_synced IS FALSE
               AND updated_at >= (NOW() - INTERVAL '5 minutes')
           )::int AS pending_sync
         FROM tasks`
      );

      out.totalSynced = Number(counts.rows[0]?.total_synced ?? 0);
      out.totalFailed = Number(counts.rows[0]?.total_failed ?? 0);
      out.pendingSync = Number(counts.rows[0]?.pending_sync ?? 0);
    } catch {
      out.totalSynced = null;
      out.totalFailed = null;
      out.pendingSync = null;
    }

    try {
      const lastWebhook = await orgPool.query(
        `SELECT event_type, created_at
         FROM webhook_events
         WHERE source = 'jira'
         ORDER BY created_at DESC
         LIMIT 1`
      );

      out.lastWebhookReceivedAt = lastWebhook.rows[0]?.created_at || null;
      out.lastWebhookEvent = lastWebhook.rows[0]?.event_type || null;
    } catch {
      out.lastWebhookReceivedAt = null;
      out.lastWebhookEvent = null;
    }

    try {
      const logs = await orgPool.query(
        `SELECT id, sync_type, direction, status, error_details, started_at
         FROM jira_sync_log
         ORDER BY started_at DESC
         LIMIT 5`
      );

      out.recentSyncLogs = logs.rows.map((r) => {
        const status = r.status ? String(r.status) : null;
        const err = status && status !== 'success' ? r.error_details : null;
        const error = err ? (typeof err === 'string' ? err : JSON.stringify(err)) : null;

        return {
          id: r.id,
          action: r.sync_type ? String(r.sync_type) : null,
          status,
          error,
          createdAt: r.started_at || null,
        };
      });
    } catch {
      out.recentSyncLogs = null;
    }

    return out;
  }

  async setSyncStatus(orgPool, { status, error }) {
    try {
      await orgPool.query(
        `UPDATE jira_integration
         SET sync_status = $1,
             sync_error = $2,
             last_sync_at = CASE WHEN $1 = 'idle' THEN NOW() ELSE last_sync_at END,
             updated_at = NOW()
         WHERE is_active = TRUE`,
        [String(status), error ? String(error) : null]
      );
    } catch (e) {
      logger.warn({ err: e }, 'Failed to update jira_integration sync status');
    }
  }
}

const jiraService = new JiraService();

module.exports = {
  JiraService,
  jiraService,
};
