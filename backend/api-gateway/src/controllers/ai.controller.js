const axios = require('axios');
const { randomUUID } = require('node:crypto');
const { buildContext } = require('../../server/lib/ragContext');
const {
  getToolDefinitions,
  executeActionWithPolicy,
  confirmPendingAction,
  ensureAgentActionsTable,
} = require('../../server/lib/agentActions');

const { env } = require('../config/env');

function buildAiServiceUrl(path) {
  const base = String(env.AI_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

function forwardHeadersToClient(upstreamResp, res) {
  // Force SSE-friendly headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Keep upstream status if possible
  res.status(upstreamResp.status);
}

function jsonError(res, status, error, detail) {
  return res.status(status).json({ error, code: status, detail });
}

function safe(value) {
  return String(value || '').trim();
}

function setSseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function extractText(contentBlocks) {
  return (Array.isArray(contentBlocks) ? contentBlocks : [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

function toToolResultBlock(toolUseId, result) {
  return {
    type: 'tool_result',
    tool_use_id: String(toolUseId),
    content: JSON.stringify(result || {}),
  };
}

async function callAnthropicMessages(apiKey, payload) {
  const resp = await axios({
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    timeout: 120_000,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    data: payload,
    validateStatus: () => true,
  });

  if (resp.status >= 400) {
    const detail = safe(resp.data?.error?.message || resp.data?.message || JSON.stringify(resp.data));
    throw Object.assign(new Error(detail || 'Anthropic request failed'), { statusCode: resp.status || 502 });
  }

  return resp.data || {};
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function systemPromptByMode(mode) {
  const base =
    'You are an Agentic Scrum Master AI embedded in the Sprint platform. ' +
    "You have access to the team's live sprint data, task history, GitHub repository content including issues, " +
    'PRs, commits, and README. Always be specific - reference real task codes, developer names, sprint names from the context provided. ' +
    `Be concise and actionable.\nToday: ${todayIso()}`;

  const suffix = {
    plan:
      'Focus on sprint planning. Suggest which backlog items to pull into the next sprint based on team velocity and capacity. ' +
      'Recommend assignments based on skills and current workload.',
    standup:
      'Generate structured standups per developer. Format:\nDeveloper Name:\n- Yesterday: ...\n- Today: ...\n- Blockers: ...',
    report:
      'Generate a sprint health report. Include: completion rate, at-risk tasks, velocity vs previous sprints, team highlights.',
    assign:
      'Recommend optimal task assignments. Score each developer on: skill match, current load, past velocity on similar tasks. ' +
      'Show reasoning for each recommendation.',
    brief:
      'You are in briefing mode. Summarize sprint state clearly and answer follow-up questions in concise executive language.',
    chat: '',
  };

  return suffix[mode] ? `${base}\n\n${suffix[mode]}` : base;
}

async function ensureProjectAccess(orgPool, projectId, actorMemberId, role) {
  const existsResp = await orgPool.query('SELECT id FROM projects WHERE id = $1 LIMIT 1', [String(projectId)]);
  if (!existsResp.rows[0]) return { ok: false, reason: 'Project not found in org database.' };

  const tokenRole = safe(role).toLowerCase();
  if (tokenRole === 'owner' || tokenRole === 'admin') return { ok: true };

  const memberResp = await orgPool.query(
    'SELECT 1 FROM project_members WHERE project_id = $1 AND member_id = $2 LIMIT 1',
    [String(projectId), String(actorMemberId)]
  );
  if (!memberResp.rows[0]) return { ok: false, reason: 'User is not a member of this project.' };
  return { ok: true };
}

async function ensureConversationsTable(orgPool) {
  await orgPool.query(
    `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      user_id TEXT,
      mode TEXT,
      user_message TEXT,
      ai_response TEXT,
      context_chunks INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`
  );
}

async function history(req, res, next) {
  try {
    const projectId = safe(req.query.projectId);
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 100));

    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    await ensureConversationsTable(req.orgDb);
    const resp = await req.orgDb.query(
      `SELECT id, project_id, user_id, mode, user_message, ai_response, context_chunks, created_at
       FROM conversations
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [projectId, limit]
    );

    return res.status(200).json({ items: resp.rows });
  } catch (err) {
    return next(err);
  }
}

async function chat(req, res, next) {
  try {
    const body = req.body || {};
    const message = safe(body.message);
    const projectId = safe(body.projectId);
    const modeInput = safe(body.mode || 'chat').toLowerCase();
    const mode = modeInput === 'auto' ? 'chat' : modeInput;
    const executionMode = safe(body.executionMode || body.actionMode || modeInput || 'confirm').toLowerCase();
    const historyList = Array.isArray(body.history) ? body.history : [];

    if (!message) return jsonError(res, 400, 'Bad request', 'message is required.');
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const allowedModes = new Set(['chat', 'plan', 'standup', 'report', 'assign', 'brief']);
    if (!allowedModes.has(mode)) return jsonError(res, 400, 'Bad request', 'mode must be one of chat|plan|standup|report|assign|brief.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const { ragText, liveText, totalChunks } = await buildContext(message, projectId, req.orgDb);
    const systemPrompt = `${systemPromptByMode(mode)}\n\nCONTEXT:\n${ragText || '(no vector context)'}\n\nLIVE DATA:\n${liveText}`;

    const trimmedHistory = historyList
      .slice(-10)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && safe(m.content))
      .map((m) => ({ role: m.role, content: safe(m.content) }));

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!safe(anthropicApiKey)) return jsonError(res, 500, 'Server error', 'ANTHROPIC_API_KEY is not configured.');

    const messages = [...trimmedHistory, { role: 'user', content: message }];
    const tools = getToolDefinitions();
    const firstResponse = await callAnthropicMessages(anthropicApiKey, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      stream: false,
      system: systemPrompt,
      messages,
      tools,
    });

    let finalText = extractText(firstResponse.content);
    if (firstResponse.stop_reason === 'tool_use') {
      const toolUses = (Array.isArray(firstResponse.content) ? firstResponse.content : []).filter((b) => b?.type === 'tool_use');
      const toolResults = [];

      for (const block of toolUses) {
        const result = await executeActionWithPolicy(req.orgDb, {
          projectId,
          userId: String(req.user?.userId || ''),
          executionMode,
        }, String(block.name), block.input || {});

        if (result?.type === 'confirmation_required') {
          return res.status(200).json(result);
        }

        toolResults.push(toToolResultBlock(block.id, result));
      }

      const secondMessages = [
        ...messages,
        { role: 'assistant', content: firstResponse.content },
        { role: 'user', content: toolResults },
      ];

      const secondResponse = await callAnthropicMessages(anthropicApiKey, {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        stream: false,
        system: systemPrompt,
        messages: secondMessages,
        tools,
      });
      finalText = extractText(secondResponse.content);
    }

    setSseHeaders(res);
    res.write(`data: ${finalText || ''}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

    try {
      await ensureConversationsTable(req.orgDb);
      await req.orgDb.query(
        `INSERT INTO conversations (id, project_id, user_id, mode, user_message, ai_response, context_chunks)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), projectId, String(req.user?.userId || ''), mode, message, finalText || '', Number(totalChunks || 0)]
      );
    } catch {
      // best effort persistence
    }

    return undefined;
  } catch (err) {
    return next(err);
  }
}

async function confirmAction(req, res, next) {
  try {
    const actionId = safe(req.body?.actionId);
    if (!actionId) return jsonError(res, 400, 'Bad request', 'actionId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    await ensureAgentActionsTable(req.orgDb);
    const rowResp = await req.orgDb.query('SELECT project_id FROM agent_actions WHERE id = $1 LIMIT 1', [actionId]);
    const projectId = safe(rowResp.rows[0]?.project_id);
    if (!projectId) return jsonError(res, 404, 'Not found', 'Pending action not found.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const result = await confirmPendingAction(req.orgDb, {
      projectId,
      userId: String(req.user?.userId || ''),
      executionMode: 'auto',
    }, actionId);

    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

async function sprintPlan(req, res, next) {
  try {
    const projectId = safe(req.query.projectId || req.body?.projectId);
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const [tasksResp, devResp] = await Promise.all([
      req.orgDb.query(
        `SELECT id, title, jira_issue_key, COALESCE(story_points, 3)::int AS points
         FROM tasks
         WHERE project_id = $1 AND (sprint_id IS NULL OR status = 'todo')
         ORDER BY created_at ASC
         LIMIT 20`,
        [projectId]
      ),
      req.orgDb.query(
        `SELECT dp.id AS developer_id, COALESCE(dp.name, tm.full_name, tm.email) AS developer_name,
                COALESCE(COUNT(t.id) FILTER (WHERE t.status <> 'done'), 0)::int AS active_tasks
         FROM developer_profiles dp
         JOIN team_members tm ON tm.id = dp.member_id
         LEFT JOIN tasks t ON t.assignee_id = dp.id AND t.project_id = $1
         GROUP BY dp.id, dp.name, tm.full_name, tm.email
         ORDER BY developer_name ASC`,
        [projectId]
      ),
    ]);

    const devs = devResp.rows.map((row) => ({ id: String(row.developer_id), name: safe(row.developer_name), load: Number(row.active_tasks || 0) }));
    if (!devs.length) return res.status(200).json({ proposedTasks: [], assignments: [], totalPoints: 0, capacityUsed: 0, capacityTotal: 0 });

    const proposedTasks = tasksResp.rows.slice(0, 12).map((task, idx) => {
      const target = devs[idx % devs.length];
      target.load += 1;
      return {
        taskId: String(task.id),
        code: safe(task.jira_issue_key) || `TASK-${String(task.id).slice(0, 6)}`,
        title: safe(task.title),
        points: Number(task.points || 0),
        assignedTo: target.id,
        assignedToName: target.name,
        reason: `Load-aware assignment: ${target.name} currently has ${Math.max(0, target.load - 1)} active tasks.`,
      };
    });

    const totalPoints = proposedTasks.reduce((sum, item) => sum + Number(item.points || 0), 0);
    const capacityTotal = devs.length * 8;
    const capacityUsed = capacityTotal > 0 ? Math.round((totalPoints / capacityTotal) * 100) : 0;
    return res.status(200).json({ proposedTasks, assignments: proposedTasks, totalPoints, capacityUsed, capacityTotal });
  } catch (err) {
    return next(err);
  }
}

async function startSprintPlan(req, res, next) {
  try {
    const projectId = safe(req.body?.projectId);
    const name = safe(req.body?.name || `Sprint ${todayIso()}`);
    const startDate = safe(req.body?.startDate || todayIso());
    const endDate = safe(req.body?.endDate);
    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!endDate) return jsonError(res, 400, 'Bad request', 'endDate is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const sprint = await executeActionWithPolicy(req.orgDb, {
      projectId,
      userId: String(req.user?.userId || ''),
      executionMode: 'auto',
    }, 'create_sprint', {
      name,
      startDate,
      endDate,
      goal: safe(req.body?.goal),
    });

    const sprintId = safe(sprint?.id);
    if (!sprintId) return jsonError(res, 500, 'Server error', 'Failed to create sprint from approved plan.');

    const moved = [];
    for (const assignment of assignments.slice(0, 40)) {
      const taskId = safe(assignment?.taskId || assignment?.id);
      const assigneeId = safe(assignment?.assignedTo || assignment?.assigneeId);
      if (!taskId) continue;

      await executeActionWithPolicy(req.orgDb, { projectId, userId: String(req.user?.userId || ''), executionMode: 'auto' }, 'move_tasks_to_sprint', {
        sprintId,
        taskIds: [taskId],
      });

      if (assigneeId) {
        await executeActionWithPolicy(req.orgDb, { projectId, userId: String(req.user?.userId || ''), executionMode: 'auto' }, 'assign_task', {
          taskId,
          assigneeId,
        });
      }
      moved.push({ taskId, assigneeId });
    }

    return res.status(200).json({ success: true, sprintId, movedCount: moved.length, moved });
  } catch (err) {
    return next(err);
  }
}

async function rebalance(req, res, next) {
  try {
    const projectId = safe(req.body?.projectId || req.query.projectId);
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const tasksResp = await req.orgDb.query(
      `SELECT t.id, t.title, t.assignee_id, t.story_points,
              COALESCE(dp.name, tm.full_name, tm.email) AS assignee_name
       FROM tasks t
       LEFT JOIN developer_profiles dp ON dp.id = t.assignee_id
       LEFT JOIN team_members tm ON tm.id = dp.member_id
       WHERE t.project_id = $1 AND t.assignee_id IS NOT NULL AND t.status <> 'done'
       ORDER BY COALESCE(t.story_points, 1) DESC, t.created_at ASC`,
      [projectId]
    );

    const byAssignee = new Map();
    for (const row of tasksResp.rows) {
      const assigneeId = safe(row.assignee_id);
      const points = Number(row.story_points || 1);
      byAssignee.set(assigneeId, { assigneeId, name: safe(row.assignee_name), load: (byAssignee.get(assigneeId)?.load || 0) + points });
    }

    const loads = [...byAssignee.values()].sort((a, b) => b.load - a.load);
    if (loads.length < 2) return res.status(200).json({ proposals: [], detail: 'Not enough assignees for rebalance.' });

    const source = loads[0];
    const target = loads[loads.length - 1];
    const candidate = tasksResp.rows.find((row) => safe(row.assignee_id) === source.assigneeId);
    if (!candidate || source.load - target.load < 2) {
      return res.status(200).json({ proposals: [], detail: 'Team load is already balanced.' });
    }

    return res.status(200).json({
      proposals: [
        {
          taskId: String(candidate.id),
          title: safe(candidate.title),
          fromAssigneeId: source.assigneeId,
          fromAssigneeName: source.name,
          toAssigneeId: target.assigneeId,
          toAssigneeName: target.name,
          reason: `${source.name} is overloaded compared to ${target.name}.`,
        },
      ],
    });
  } catch (err) {
    return next(err);
  }
}

async function briefing(req, res, next) {
  try {
    const projectId = safe(req.query.projectId);
    const date = safe(req.query.date || todayIso());
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    await req.orgDb.query(
      `CREATE TABLE IF NOT EXISTS agent_briefings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        brief_date DATE NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`
    );

    const cachedResp = await req.orgDb.query(
      `SELECT payload FROM agent_briefings WHERE project_id = $1 AND brief_date = $2::date ORDER BY created_at DESC LIMIT 1`,
      [projectId, date]
    );
    if (cachedResp.rows[0]?.payload) return res.status(200).json(cachedResp.rows[0].payload);

    const [actionsResp, approvalsResp, sprintResp] = await Promise.all([
      req.orgDb.query(
        `SELECT action_name, status, created_at
         FROM agent_actions
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT 12`,
        [projectId]
      ),
      req.orgDb.query(`SELECT id, title, description FROM agent_approvals WHERE project_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 6`, [projectId]),
      req.orgDb.query(`SELECT name, "riskLevel" FROM sprints WHERE project_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`, [projectId]),
    ]);

    const payload = {
      date,
      generatedAt: new Date().toISOString(),
      metrics: {
        sprintHealth: approvalsResp.rows.length > 2 ? 'At Risk' : 'On Track',
        team: `${Math.max(1, Math.min(4, actionsResp.rows.length))} active`,
        github: 'Connected',
        risk: safe(sprintResp.rows[0]?.riskLevel || 'ON_TRACK'),
      },
      whatAgentDid: actionsResp.rows.map((row) => `${safe(row.action_name)} - ${safe(row.status)} (${new Date(row.created_at).toLocaleTimeString()})`),
      needsAttention: approvalsResp.rows.map((row) => ({ id: String(row.id), title: safe(row.title), detail: safe(row.description) })),
    };

    await req.orgDb.query(
      `INSERT INTO agent_briefings (id, project_id, brief_date, payload)
       VALUES ($1, $2, $3::date, $4::jsonb)`,
      [randomUUID(), projectId, date, JSON.stringify(payload)]
    );

    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
}

async function proxyJson(req, res, next, upstreamPath) {
  try {
    const url = buildAiServiceUrl(upstreamPath);
    const resp = await axios({
      method: req.method,
      url,
      headers: {
        'Content-Type': 'application/json',
      },
      data: req.body,
      timeout: 30_000,
      validateStatus: () => true,
    });

    res.status(resp.status).json(resp.data);
  } catch (err) {
    next(err);
  }
}

async function proxySse(req, res, next, upstreamPath) {
  try {
    const url = buildAiServiceUrl(upstreamPath);

    const upstream = await axios({
      method: req.method,
      url,
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      data: req.body,
      responseType: 'stream',
      timeout: 0,
      validateStatus: () => true,
    });

    forwardHeadersToClient(upstream, res);

    // Pipe upstream SSE stream to client.
    upstream.data.pipe(res);

    // Cleanup if client disconnects.
    req.on('close', () => {
      try {
        upstream.data.destroy();
      } catch {
        // ignore
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  chat,
  confirmAction,
  history,
  sprintPlan,
  startSprintPlan,
  rebalance,
  briefing,
  planSprint(req, res, next) {
    return proxyJson(req, res, next, '/sprint-planning/plan');
  },

  finalizeScope(req, res, next) {
    return proxyJson(req, res, next, '/sprint-planning/scope');
  },

  agenticSprintBuild(req, res, next) {
    return proxyJson(req, res, next, '/agentic/sprint-build');
  },

  autonomousAutopilot(req, res, next) {
    return proxyJson(req, res, next, '/autonomous/autopilot');
  },

  autonomousTeamRebalance(req, res, next) {
    return proxyJson(req, res, next, '/autonomous/team-rebalance');
  },

  autonomousBriefing(req, res, next) {
    return proxyJson(req, res, next, '/autonomous/briefing');
  },

  ticketEnrichmentStream(req, res, next) {
    return proxySse(req, res, next, '/groq/ticket-enrichment/stream');
  },

  standupSummarizerStream(req, res, next) {
    return proxySse(req, res, next, '/groq/standup-summarizer/stream');
  },

  retrospectiveGeneratorStream(req, res, next) {
    return proxySse(req, res, next, '/groq/retrospective-generator/stream');
  },

  riskNarratorStream(req, res, next) {
    return proxySse(req, res, next, '/groq/risk-narrator/stream');
  },

  // ML (internal)
  meritTrain(req, res, next) {
    return proxyJson(req, res, next, '/ml/merit/train');
  },

  meritPredict(req, res, next) {
    return proxyJson(req, res, next, '/ml/merit/predict');
  },

  velocityTrain(req, res, next) {
    return proxyJson(req, res, next, '/ml/velocity/train');
  },

  velocityPredict(req, res, next) {
    return proxyJson(req, res, next, '/ml/velocity/predict');
  },

  complexityTrain(req, res, next) {
    return proxyJson(req, res, next, '/ml/complexity/train');
  },

  complexityPredict(req, res, next) {
    return proxyJson(req, res, next, '/ml/complexity/predict');
  },

  burndownTrain(req, res, next) {
    return proxyJson(req, res, next, '/ml/burndown/train');
  },

  burndownDetect(req, res, next) {
    return proxyJson(req, res, next, '/ml/burndown/detect');
  },
};
