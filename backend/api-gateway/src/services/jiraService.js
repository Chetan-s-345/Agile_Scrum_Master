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

    return { connected: true, identity };
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

  async getStatus(orgPool) {
    const integ = await this.getIntegration(orgPool);
    if (!integ) return { connected: false };

    return {
      connected: Boolean(integ.is_active),
      baseUrl: integ.base_url,
      projectKey: integ.project_key,
      lastSyncAt: integ.last_sync_at,
      syncStatus: integ.sync_status,
      syncError: integ.sync_error,
      fieldMappings: integ.field_mappings || {},
    };
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
