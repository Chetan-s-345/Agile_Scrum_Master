const { assignmentService } = require('./assignment.service');
const { queueJiraTaskSync } = require('./jiraSync.service');
const { queueEmbedTask } = require('../../server/lib/githubIngestion');
const { sendInngestEvent } = require('./inngestEvent.service');

function requireOrgDb(req) {
  const pool = req.orgDb;
  if (!pool) throw Object.assign(new Error('Org DB not attached'), { statusCode: 500 });
  return pool;
}

function parseDateToIso(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function getActorMemberId(orgPool, userId) {
  const resp = await orgPool.query('SELECT id FROM team_members WHERE global_user_id = $1 LIMIT 1', [String(userId)]);
  return resp.rows[0]?.id || null;
}

class TaskService {
  mapSubtaskRow(row) {
    return {
      id: row.id,
      parentTaskId: row.parent_task_id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      storyPoints: Number(row.story_points || 0),
      taskKey: row.jira_issue_key || null,
      assignee: row.assignee_id
        ? {
            id: row.assignee_id,
            name: row.assignee_name || null,
            avatarUrl: row.assignee_avatar || null,
          }
        : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listSubtasks(req, taskId) {
    const orgPool = requireOrgDb(req);

    const parentResp = await orgPool.query('SELECT id FROM tasks WHERE id = $1 LIMIT 1', [String(taskId)]);
    if (!parentResp.rows[0]) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

    const resp = await orgPool.query(
      `SELECT
         t.id,
         t.parent_task_id,
         t.project_id,
         t.sprint_id,
         t.title,
         t.status,
         t.priority,
         t.story_points,
         t.jira_issue_key,
         t.assignee_id,
         t.created_at,
         t.updated_at,
         tm.full_name AS assignee_name,
         tm.avatar_url AS assignee_avatar
       FROM tasks t
       LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
       LEFT JOIN team_members tm ON tm.id = dp.member_id
       WHERE t.parent_task_id = $1
       ORDER BY t.created_at ASC`,
      [String(taskId)]
    );

    return resp.rows.map((row) => this.mapSubtaskRow(row));
  }

  async createSubtask(req, taskId, payload) {
    const orgPool = requireOrgDb(req);
    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const parentResp = await orgPool.query(
      `SELECT id, project_id, sprint_id
       FROM tasks
       WHERE id = $1
       LIMIT 1`,
      [String(taskId)]
    );
    const parent = parentResp.rows[0] || null;
    if (!parent) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

    const insertResp = await orgPool.query(
      `INSERT INTO tasks (
         project_id,
         sprint_id,
         parent_task_id,
         is_subtask,
         title,
         description,
         status,
         priority,
         type,
         story_points,
         created_by
       ) VALUES ($1,$2,$3,TRUE,$4,$5,'todo',$6,'task',$7,$8)
       RETURNING *`,
      [
        String(parent.project_id),
        parent.sprint_id ? String(parent.sprint_id) : null,
        String(parent.id),
        String(payload.title),
        payload.description || null,
        payload.priority || 'medium',
        Number(payload.storyPoints || 0),
        actorMemberId,
      ]
    );

    const row = insertResp.rows[0];
    const assigneeResp = await orgPool.query(
      `SELECT tm.full_name AS assignee_name, tm.avatar_url AS assignee_avatar
       FROM developer_profiles dp
       JOIN team_members tm ON tm.id = dp.member_id
       WHERE dp.id = $1
       LIMIT 1`,
      [row.assignee_id || null]
    );

    return this.mapSubtaskRow({
      ...row,
      assignee_name: assigneeResp.rows[0]?.assignee_name || null,
      assignee_avatar: assigneeResp.rows[0]?.assignee_avatar || null,
    });
  }

  async updateAssignee(jiraIssueKey, newAssigneeAccountId, orgPool) {
    if (!orgPool) throw Object.assign(new Error('Org DB not provided'), { statusCode: 500 });
    const issueKey = String(jiraIssueKey || '').trim();
    if (!issueKey) return { ok: true, ignored: true, reason: 'missing_issue_key' };

    const taskResp = await orgPool.query(
      'SELECT id, assignee_id, story_points FROM tasks WHERE jira_issue_key = $1 LIMIT 1',
      [issueKey]
    );
    const task = taskResp.rows[0] || null;
    if (!task) return { ok: true, ignored: true, reason: 'task_not_found' };

    let newAssigneeId = null;
    if (newAssigneeAccountId) {
      const devResp = await orgPool.query(
        `SELECT dp.id
         FROM developer_profiles dp
         JOIN team_members tm ON tm.id = dp.member_id
         WHERE tm.jira_account_id = $1
         LIMIT 1`,
        [String(newAssigneeAccountId)]
      );
      newAssigneeId = devResp.rows[0]?.id || null;
    }

    const currentAssigneeId = task.assignee_id || null;
    if (String(currentAssigneeId || '') === String(newAssigneeId || '')) {
      return { ok: true, changed: false };
    }

    await orgPool.query(
      `UPDATE tasks
       SET assignee_id = $2,
           assigned_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [String(task.id), newAssigneeId]
    );

    const points = Number(task.story_points || 0);
    if (points) {
      if (currentAssigneeId) {
        await orgPool.query(
          `UPDATE developer_profiles
           SET current_sprint_load = GREATEST(0, current_sprint_load - $2), updated_at = NOW()
           WHERE id = $1`,
          [String(currentAssigneeId), points]
        );
      }
      if (newAssigneeId) {
        await orgPool.query(
          `UPDATE developer_profiles
           SET current_sprint_load = GREATEST(0, current_sprint_load + $2), updated_at = NOW()
           WHERE id = $1`,
          [String(newAssigneeId), points]
        );
      }
    }

    return { ok: true, changed: true, assigneeId: newAssigneeId };
  }

  async updateStatus(jiraIssueKey, newStatusName, orgPool) {
    if (!orgPool) throw Object.assign(new Error('Org DB not provided'), { statusCode: 500 });
    const issueKey = String(jiraIssueKey || '').trim();
    if (!issueKey) return { ok: true, ignored: true, reason: 'missing_issue_key' };

    const statusRaw = String(newStatusName || '').trim().toLowerCase();
    if (!statusRaw) return { ok: true, ignored: true, reason: 'missing_status_name' };

    let mapped = 'todo';
    if (statusRaw.includes('progress') || statusRaw.includes('doing')) mapped = 'in_progress';
    else if (statusRaw.includes('review') || statusRaw.includes('qa')) mapped = 'in_review';
    else if (statusRaw.includes('block')) mapped = 'blocked';
    else if (statusRaw.includes('done') || statusRaw.includes('closed') || statusRaw.includes('resolve')) mapped = 'done';
    else if (statusRaw.includes('cancel') || statusRaw.includes("won't") || statusRaw.includes('wont')) mapped = 'cancelled';

    const taskResp = await orgPool.query(
      'SELECT id, status, started_at, completed_at, sprint_id FROM tasks WHERE jira_issue_key = $1 LIMIT 1',
      [issueKey]
    );
    const task = taskResp.rows[0] || null;
    if (!task) return { ok: true, ignored: true, reason: 'task_not_found' };

    if (String(task.status) === mapped) return { ok: true, changed: false, status: mapped };

    const sets = ['status = $2', 'updated_at = NOW()'];
    const params = [String(task.id), mapped];

    if (mapped === 'in_progress' && !task.started_at) sets.push('started_at = NOW()');
    if (mapped === 'done' && !task.completed_at) sets.push('completed_at = NOW()');

    await orgPool.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $1`, params);

    // Keep sprint rollups consistent (idempotent).
    if (task.sprint_id) {
      await orgPool.query(
        `UPDATE sprints
         SET completed_points = (
           SELECT COALESCE(SUM(story_points), 0)::int FROM tasks WHERE sprint_id = $1 AND status = 'done'
         ), updated_at = NOW()
         WHERE id = $1`,
        [String(task.sprint_id)]
      );
    }

    return { ok: true, changed: true, status: mapped };
  }

  async updateStoryPoints(jiraIssueKey, newValue, orgPool) {
    if (!orgPool) throw Object.assign(new Error('Org DB not provided'), { statusCode: 500 });
    const issueKey = String(jiraIssueKey || '').trim();
    if (!issueKey) return { ok: true, ignored: true, reason: 'missing_issue_key' };

    const points = newValue === null || newValue === undefined || String(newValue).trim() === '' ? 0 : Number(newValue);
    if (!Number.isFinite(points) || points < 0) return { ok: true, ignored: true, reason: 'invalid_story_points' };

    const taskResp = await orgPool.query(
      'SELECT id, story_points, assignee_id, sprint_id FROM tasks WHERE jira_issue_key = $1 LIMIT 1',
      [issueKey]
    );
    const task = taskResp.rows[0] || null;

    if (task) {
      const before = Number(task.story_points || 0);
      if (before === points) return { ok: true, changed: false, storyPoints: points };

      await orgPool.query(
        `UPDATE tasks
         SET story_points = $2, updated_at = NOW()
         WHERE id = $1`,
        [String(task.id), points]
      );

      const delta = points - before;
      if (delta !== 0 && task.assignee_id) {
        await orgPool.query(
          `UPDATE developer_profiles
           SET current_sprint_load = GREATEST(0, current_sprint_load + $2), updated_at = NOW()
           WHERE id = $1`,
          [String(task.assignee_id), delta]
        );
      }

      if (task.sprint_id) {
        await orgPool.query(
          `UPDATE sprints
           SET planned_points = (
             SELECT COALESCE(SUM(story_points), 0)::int FROM tasks WHERE sprint_id = $1 AND status <> 'cancelled'
           ),
           completed_points = (
             SELECT COALESCE(SUM(story_points), 0)::int FROM tasks WHERE sprint_id = $1 AND status = 'done'
           ),
           updated_at = NOW()
           WHERE id = $1`,
          [String(task.sprint_id)]
        );
      }

      return { ok: true, changed: true, storyPoints: points };
    }

    // Fallback: backlog item.
    await orgPool.query(
      `UPDATE backlog_items
       SET story_points = $2,
           updated_at = NOW()
       WHERE jira_issue_key = $1
         AND story_points IS DISTINCT FROM $2`,
      [issueKey, points]
    );

    return { ok: true, updated: 'backlog_item', storyPoints: points };
  }

  async getById(req, taskId) {
    const orgPool = requireOrgDb(req);

    const resp = await orgPool.query(
      `SELECT
         t.*,
         tm.full_name AS assignee_name,
         tm.avatar_url AS assignee_avatar
       FROM tasks t
       LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
       LEFT JOIN team_members tm ON tm.id = dp.member_id
       WHERE t.id = $1
       LIMIT 1`,
      [String(taskId)]
    );

    const t = resp.rows[0];
    if (!t) return null;

    const subtasks = await this.listSubtasks(req, taskId);

    return {
      id: t.id,
      sprintId: t.sprint_id,
      projectId: t.project_id,
      backlogItemId: t.backlog_item_id,
      title: t.title,
      description: t.description,
      type: t.type,
      priority: t.priority,
      status: t.status,
      storyPoints: Number(t.story_points || 0),
      techTags: t.tech_tags || [],
      acceptanceCriteria: t.acceptance_criteria,
      dueDate: t.due_date,
      aiRiskScore: t.ai_risk_score,
      loggedHours: Number(t.logged_hours || 0),
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      startedAt: t.started_at,
      completedAt: t.completed_at,
      assignee: t.assignee_id
        ? {
            id: t.assignee_id,
            name: t.assignee_name,
            avatarUrl: t.assignee_avatar,
          }
        : null,
      subtasks,
    };
  }

  async getProgress(req, taskId) {
    const orgPool = requireOrgDb(req);

    const taskResp = await orgPool.query('SELECT id, progress FROM tasks WHERE id = $1 LIMIT 1', [String(taskId)]);
    const task = taskResp.rows[0] || null;
    if (!task) return null;

    const evResp = await orgPool.query(
      `SELECT event_type, branch_name, raw_payload, event_at
       FROM github_events
       WHERE task_id = $1
       ORDER BY event_at DESC
       LIMIT 1`,
      [String(taskId)]
    );

    const ev = evResp.rows[0] || null;
    const raw = ev?.raw_payload || {};

    return {
      progress: Number(task.progress || 0),
      lastGithubEvent: ev?.event_type || null,
      prUrl: raw?.pull_request?.html_url || raw?.html_url || null,
      branch: ev?.branch_name || raw?.pull_request?.head?.ref || null,
    };
  }

  async list(req, filters) {
    const orgPool = requireOrgDb(req);

    const where = [];
    const params = [];
    const push = (expr, val) => {
      params.push(val);
      where.push(expr.replace('?', `$${params.length}`));
    };

    if (filters.sprintId) push('t.sprint_id = ?', String(filters.sprintId));
    if (filters.projectId) push('t.project_id = ?', String(filters.projectId));
    if (filters.assigneeId) push('t.assignee_id = ?', String(filters.assigneeId));
    if (filters.status) push('t.status = ?', String(filters.status));

    const resp = await orgPool.query(
      `SELECT
         t.id,
         t.title,
         t.status,
         t.story_points,
         t.tech_tags,
         t.ai_risk_score,
         t.assignee_id,
         tm.full_name AS assignee_name,
         tm.avatar_url AS assignee_avatar
       FROM tasks t
       LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
       LEFT JOIN team_members tm ON tm.id = dp.member_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY t.created_at DESC
       LIMIT 500`,
      params
    );

    return resp.rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      storyPoints: Number(r.story_points || 0),
      techTags: r.tech_tags || [],
      aiRiskScore: r.ai_risk_score,
      assignee: r.assignee_id
        ? {
            id: r.assignee_id,
            name: r.assignee_name,
            avatarUrl: r.assignee_avatar,
          }
        : null,
    }));
  }

  async create(req, payload) {
    const orgPool = requireOrgDb(req);

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const dueIso = payload.dueDate ? parseDateToIso(payload.dueDate) : null;
    if (payload.dueDate && !dueIso) throw Object.assign(new Error('Invalid dueDate'), { statusCode: 400 });

    await orgPool.query('BEGIN');
    try {
      const insertResp = await orgPool.query(
        `INSERT INTO tasks (
           backlog_item_id, sprint_id, project_id,
           title, description, type, priority,
           story_points, tech_tags, acceptance_criteria, due_date,
           created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12)
         RETURNING *`,
        [
          payload.backlogItemId || null,
          String(payload.sprintId),
          String(payload.projectId),
          String(payload.title),
          payload.description || null,
          payload.type || 'task',
          payload.priority || 'medium',
          Number(payload.storyPoints || 0),
          payload.techTags || [],
          payload.acceptanceCriteria || null,
          dueIso,
          actorMemberId,
        ]
      );

      const task = insertResp.rows[0];

      if (payload.backlogItemId) {
        await orgPool.query(
          `UPDATE backlog_items
           SET status = 'in_sprint', updated_at = NOW()
           WHERE id = $1`,
          [String(payload.backlogItemId)]
        );
      }

      // Auto-trigger assignment
      let assignment = null;
      if (payload.autoAssign !== false) {
        try {
          assignment = await assignmentService.assign(req, {
            taskId: String(task.id),
            sprintId: String(task.sprint_id),
            techTags: task.tech_tags || [],
            storyPoints: Number(task.story_points || 0),
            priority: task.priority,
          });
        } catch (e) {
          assignment = { assigned: false, reason: e?.message || 'Assignment failed', suggestion: null };
        }
      }

      // Update sprint planned points
      await orgPool.query(
        `UPDATE sprints
         SET planned_points = (
           SELECT COALESCE(SUM(story_points), 0)::int FROM tasks WHERE sprint_id = $1 AND status <> 'cancelled'
         ), updated_at = NOW()
         WHERE id = $1`,
        [String(task.sprint_id)]
      );

      await orgPool.query('COMMIT');

      // Best-effort Jira sync trigger (if integration active)
      await queueJiraTaskSync(req, {
        taskId: String(task.id),
        action: 'create',
        projectId: String(task.project_id),
        sprintId: String(task.sprint_id),
      });

      queueEmbedTask({ task, orgPool });

      try {
        await sendInngestEvent('task/created', {
          orgId: String(req.user?.orgId || ''),
          projectId: String(task.project_id),
          sprintId: String(task.sprint_id),
          taskId: String(task.id),
          title: String(task.title || ''),
          priority: String(task.priority || 'medium'),
          storyPoints: Number(task.story_points || 0),
          techTags: Array.isArray(task.tech_tags) ? task.tech_tags : [],
          assigneeId: task.assignee_id ? String(task.assignee_id) : null,
        });
      } catch {
        // Do not fail task creation if event dispatch fails.
      }

      return { task, assignment };
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }
  }

  async updateStatus(req, taskId, payload) {
    const orgPool = requireOrgDb(req);

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);

    const beforeResp = await orgPool.query('SELECT * FROM tasks WHERE id = $1', [String(taskId)]);
    const before = beforeResp.rows[0];
    if (!before) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

    const nextStatus = String(payload.status);

    await orgPool.query('BEGIN');
    try {
      const sets = ['status = $2', 'updated_at = NOW()'];
      const params = [String(taskId), nextStatus];

      if (nextStatus === 'in_progress' && !before.started_at) {
        sets.push('started_at = NOW()');
      }

      if (nextStatus === 'done') {
        sets.push('completed_at = NOW()');
      }

      const updResp = await orgPool.query(
        `UPDATE tasks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params
      );
      const after = updResp.rows[0];

      // Comment for status change
      await orgPool.query(
        `INSERT INTO task_comments (task_id, author_id, content, comment_type, metadata)
         VALUES ($1,$2,$3,'status_change',$4)
         RETURNING id`,
        [String(taskId), actorMemberId, `Status changed: ${before.status} → ${nextStatus}`, { from: before.status, to: nextStatus }]
      );

      if (nextStatus === 'done') {
        await orgPool.query(
          `UPDATE sprints
           SET completed_points = (
             SELECT COALESCE(SUM(story_points), 0)::int FROM tasks WHERE sprint_id = $1 AND status = 'done'
           ), updated_at = NOW()
           WHERE id = $1`,
          [String(after.sprint_id)]
        );
      }

      if (nextStatus === 'blocked') {
        // Best-effort delay alert
        await orgPool.query(
          `INSERT INTO delay_alerts (sprint_id, task_id, developer_id, alert_type, severity, title, message, suggestion)
           VALUES ($1,$2,$3,'blocker','warning',$4,$5,$6)`,
          [
            String(after.sprint_id),
            String(taskId),
            after.assignee_id || null,
            `Task blocked: ${after.title}`,
            `Task marked as blocked.`,
            `Review blockers and consider reassignment.`,
          ]
        );
      }

      await orgPool.query('COMMIT');

      // Best-effort Jira sync trigger (if integration active)
      await queueJiraTaskSync(req, {
        taskId: String(after.id),
        action: 'status_update',
        projectId: String(after.project_id),
        sprintId: String(after.sprint_id),
      });

      try {
        await sendInngestEvent('task/updated', {
          orgId: String(req.user?.orgId || ''),
          projectId: String(after.project_id),
          sprintId: String(after.sprint_id),
          taskId: String(after.id),
          title: String(after.title || ''),
          previousStatus: String(before.status || ''),
          status: String(after.status || ''),
          priority: String(after.priority || 'medium'),
          storyPoints: Number(after.story_points || 0),
          assigneeId: after.assignee_id ? String(after.assignee_id) : null,
        });
      } catch {
        // Do not fail status updates if event dispatch fails.
      }

      return after;
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }
  }

  async updateTask(req, taskId, patch) {
    const orgPool = requireOrgDb(req);

    const beforeResp = await orgPool.query('SELECT * FROM tasks WHERE id = $1', [String(taskId)]);
    const before = beforeResp.rows[0];
    if (!before) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

    const dueIso = patch.dueDate ? parseDateToIso(patch.dueDate) : undefined;
    if (patch.dueDate && !dueIso) throw Object.assign(new Error('Invalid dueDate'), { statusCode: 400 });

    const sets = [];
    const params = [];
    const push = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (patch.title !== undefined) push('title', String(patch.title));
    if (patch.description !== undefined) push('description', patch.description || null);
    if (patch.storyPoints !== undefined) push('story_points', Number(patch.storyPoints));
    if (patch.techTags !== undefined) push('tech_tags', patch.techTags || []);
    if (patch.priority !== undefined) push('priority', String(patch.priority));
    if (patch.acceptanceCriteria !== undefined) push('acceptance_criteria', patch.acceptanceCriteria || null);
    if (patch.dueDate !== undefined) push('due_date', dueIso || null);

    push('updated_at', new Date());

    const sql = `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${params.length + 1} RETURNING *`;
    params.push(String(taskId));

    const afterResp = await orgPool.query(sql, params);
    const after = afterResp.rows[0];

    // Adjust developer load if story points changed
    const beforePoints = Number(before.story_points || 0);
    const afterPoints = Number(after.story_points || 0);
    const delta = afterPoints - beforePoints;

    if (delta !== 0 && after.assignee_id) {
      await orgPool.query(
        `UPDATE developer_profiles
         SET current_sprint_load = GREATEST(0, current_sprint_load + $2), updated_at = NOW()
         WHERE id = $1`,
        [String(after.assignee_id), delta]
      );
    }

    // Best-effort Jira sync trigger (if integration active)
    await queueJiraTaskSync(req, {
      taskId: String(after.id),
      action: 'update',
      projectId: String(after.project_id),
      sprintId: String(after.sprint_id),
    });

    queueEmbedTask({ task: after, orgPool });

    try {
      await sendInngestEvent('task/updated', {
        orgId: String(req.user?.orgId || ''),
        projectId: String(after.project_id),
        sprintId: String(after.sprint_id),
        taskId: String(after.id),
        title: String(after.title || ''),
        previousStatus: String(before.status || ''),
        status: String(after.status || ''),
        priority: String(after.priority || 'medium'),
        storyPoints: Number(after.story_points || 0),
        assigneeId: after.assignee_id ? String(after.assignee_id) : null,
        changedFields: Object.keys(patch || {}),
      });
    } catch {
      // Do not fail task updates if event dispatch fails.
    }

    return after;
  }

  async cancel(req, taskId) {
    const orgPool = requireOrgDb(req);

    const beforeResp = await orgPool.query('SELECT * FROM tasks WHERE id = $1', [String(taskId)]);
    const before = beforeResp.rows[0];
    if (!before) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

    await orgPool.query('BEGIN');
    try {
      await orgPool.query(
        `UPDATE tasks
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1`,
        [String(taskId)]
      );

      if (before.assignee_id) {
        await orgPool.query(
          `UPDATE developer_profiles
           SET current_sprint_load = GREATEST(0, current_sprint_load - $2), updated_at = NOW()
           WHERE id = $1`,
          [String(before.assignee_id), Number(before.story_points || 0)]
        );
      }

      await orgPool.query(
        `UPDATE sprints
         SET planned_points = (
           SELECT COALESCE(SUM(story_points), 0)::int FROM tasks WHERE sprint_id = $1 AND status <> 'cancelled'
         ), updated_at = NOW()
         WHERE id = $1`,
        [String(before.sprint_id)]
      );

      await orgPool.query('COMMIT');
      return { ok: true };
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }
  }

  async removePermanent(req, taskId) {
    const orgPool = requireOrgDb(req);

    const beforeResp = await orgPool.query('SELECT * FROM tasks WHERE id = $1', [String(taskId)]);
    const before = beforeResp.rows[0];
    if (!before) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

    await orgPool.query('BEGIN');
    try {
      await orgPool.query('DELETE FROM tasks WHERE id = $1', [String(taskId)]);

      if (before.assignee_id) {
        await orgPool.query(
          `UPDATE developer_profiles
           SET current_sprint_load = GREATEST(0, current_sprint_load - $2), updated_at = NOW()
           WHERE id = $1`,
          [String(before.assignee_id), Number(before.story_points || 0)]
        );
      }

      await orgPool.query(
        `UPDATE sprints
         SET planned_points = (
           SELECT COALESCE(SUM(story_points), 0)::int FROM tasks WHERE sprint_id = $1 AND status <> 'cancelled'
         ), updated_at = NOW()
         WHERE id = $1`,
        [String(before.sprint_id)]
      );

      await orgPool.query('COMMIT');

      await queueJiraTaskSync(req, {
        taskId: String(taskId),
        action: 'delete',
        projectId: String(before.project_id),
        sprintId: String(before.sprint_id),
      });

      return { ok: true, deleted: true };
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }
  }

  async addComment(req, taskId, payload) {
    const orgPool = requireOrgDb(req);

    const actorMemberId = await getActorMemberId(orgPool, req.user?.userId);
    if (!actorMemberId) throw Object.assign(new Error('Team member not found'), { statusCode: 403 });

    const resp = await orgPool.query(
      `INSERT INTO task_comments (task_id, author_id, content, comment_type)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [String(taskId), actorMemberId, String(payload.content), payload.commentType || 'comment']
    );

    const c = resp.rows[0];

    const authorResp = await orgPool.query('SELECT id, full_name, email, avatar_url FROM team_members WHERE id = $1', [actorMemberId]);
    const author = authorResp.rows[0] || null;

    return {
      ...c,
      author: author
        ? { id: author.id, fullName: author.full_name, email: author.email, avatarUrl: author.avatar_url }
        : null,
    };
  }

  async listComments(req, taskId) {
    const orgPool = requireOrgDb(req);

    const resp = await orgPool.query(
      `SELECT
         c.*, 
         tm.full_name AS author_name,
         tm.email AS author_email,
         tm.avatar_url AS author_avatar
       FROM task_comments c
       LEFT JOIN team_members tm ON tm.id = c.author_id
       WHERE c.task_id = $1
       ORDER BY c.created_at ASC`,
      [String(taskId)]
    );

    return resp.rows.map((c) => ({
      id: c.id,
      taskId: c.task_id,
      content: c.content,
      commentType: c.comment_type,
      metadata: c.metadata,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      author: c.author_id
        ? { id: c.author_id, fullName: c.author_name, email: c.author_email, avatarUrl: c.author_avatar }
        : null,
    }));
  }

  async timeLog(req, taskId, payload) {
    const orgPool = requireOrgDb(req);

    const workIso = parseDateToIso(payload.workDate);
    if (!workIso) throw Object.assign(new Error('Invalid workDate'), { statusCode: 400 });

    const taskResp = await orgPool.query('SELECT id, assignee_id FROM tasks WHERE id = $1', [String(taskId)]);
    const task = taskResp.rows[0];
    if (!task) throw Object.assign(new Error('Task not found'), { statusCode: 404 });

    const hours = Number(payload.hours);

    await orgPool.query('BEGIN');
    try {
      const logResp = await orgPool.query(
        `INSERT INTO task_time_logs (task_id, developer_id, hours, work_date, description)
         VALUES ($1,$2,$3,$4::date,$5)
         RETURNING *`,
        [String(taskId), task.assignee_id || null, hours, workIso, payload.description || null]
      );

      await orgPool.query(
        `UPDATE tasks
         SET logged_hours = COALESCE(logged_hours, 0) + $2, updated_at = NOW()
         WHERE id = $1`,
        [String(taskId), hours]
      );

      await orgPool.query('COMMIT');
      return logResp.rows[0];
    } catch (e) {
      try {
        await orgPool.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw e;
    }
  }

  async board(req, sprintId) {
    const orgPool = requireOrgDb(req);

    const subtaskCountsResp = await orgPool.query(
      `SELECT
         parent_task_id,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'done')::int AS done
       FROM tasks
       WHERE sprint_id = $1
         AND parent_task_id IS NOT NULL
       GROUP BY parent_task_id`,
      [String(sprintId)]
    );

    const subtaskMap = new Map();
    for (const row of subtaskCountsResp.rows) {
      subtaskMap.set(String(row.parent_task_id), {
        total: Number(row.total || 0),
        done: Number(row.done || 0),
      });
    }

    const resp = await orgPool.query(
      `SELECT
         t.id,
         t.title,
         t.status,
         t.story_points,
         t.priority,
         t.tech_tags,
         t.ai_risk_score,
         t.assignee_id,
         tm.full_name AS assignee_name,
         tm.avatar_url AS assignee_avatar
       FROM tasks t
       LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
       LEFT JOIN team_members tm ON tm.id = dp.member_id
       WHERE t.sprint_id = $1
         AND COALESCE(t.is_subtask, FALSE) = FALSE
       ORDER BY t.created_at ASC`,
      [String(sprintId)]
    );

    const grouped = { todo: [], in_progress: [], in_review: [], blocked: [], done: [] };
    for (const t of resp.rows) {
      const key = grouped[t.status] ? t.status : 'todo';
      grouped[key].push({
        id: t.id,
        title: t.title,
        assignee: t.assignee_id ? { id: t.assignee_id, name: t.assignee_name, avatar: t.assignee_avatar } : null,
        storyPoints: Number(t.story_points || 0),
        priority: t.priority,
        techTags: t.tech_tags || [],
        aiRiskScore: t.ai_risk_score,
        subtaskProgress: subtaskMap.get(String(t.id)) || { done: 0, total: 0 },
      });
    }

    return grouped;
  }
}

const taskService = new TaskService();

module.exports = { taskService, TaskService };
