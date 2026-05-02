const axios = require('axios');
const { randomUUID } = require('node:crypto');
const { URLSearchParams } = require('url');
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
  if (typeof contentBlocks === 'string') return contentBlocks;
  if (Array.isArray(contentBlocks)) {
    return contentBlocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');
  }
  return '';
}

function normalizeGroqTools(rawTools) {
  return (Array.isArray(rawTools) ? rawTools : [])
    .map((tool) => {
      if (!tool || typeof tool !== 'object') return null;
      const fn = tool.function && typeof tool.function === 'object' ? tool.function : null;
      const name = safe(fn?.name);
      if (!name) return null;
      return {
        type: 'function',
        function: {
          name,
          description: safe(fn?.description),
          parameters: fn?.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object', properties: {} },
        },
      };
    })
    .filter(Boolean);
}

async function callGroqWithOptionalTools(apiKey, payload, tools) {
  const basePayload = { ...payload };
  if (Array.isArray(tools) && tools.length > 0) {
    basePayload.tools = tools;
  }

  try {
    return await callGroqMessages(apiKey, basePayload);
  } catch (err) {
    const detail = safe(err?.message || '');
    const shouldRetryWithoutTools =
      Array.isArray(tools) &&
      tools.length > 0 &&
      (detail.toLowerCase().includes('tools.0.type') || detail.toLowerCase().includes('tool schema'));

    if (!shouldRetryWithoutTools) throw err;

    return callGroqMessages(apiKey, payload);
  }
}

async function callGroqMessages(apiKey, payload) {
  const resp = await axios({
    method: 'POST',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    timeout: 120_000,
    headers: {
      'content-type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    data: payload,
    validateStatus: () => true,
  });

  if (resp.status >= 400) {
    const detail = safe(resp.data?.error?.message || resp.data?.message || JSON.stringify(resp.data));
    throw Object.assign(new Error(detail || 'Groq request failed'), { statusCode: resp.status || 502 });
  }

  return resp.data || {};
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function resolveGroqModel() {
  const configured = safe(process.env.GROQ_MODEL);
  const normalized = configured.toLowerCase();
  if (!configured || normalized === 'llama3-8b-8192' || normalized === 'llama-3.1-8b-instant') {
    return 'llama-3.3-70b-versatile';
  }
  return configured;
}

const MAX_USER_MESSAGE_CHARS = 1800;
const MAX_HISTORY_ITEMS = 6;
const MAX_HISTORY_ITEM_CHARS = 900;
const MAX_RAG_CHARS = 7000;
const MAX_LIVE_CHARS = 5000;
const MAX_GRAPH_CHARS = 9000;

function truncateText(value, maxChars) {
  const text = safe(value);
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

function isGroqPayloadTooLargeError(detail) {
  const value = safe(detail).toLowerCase();
  return value.includes('request too large') || value.includes('tokens per minute') || value.includes('requested ');
}

function buildSystemPrompt(mode, ragText, liveText, graphContext, compact = false) {
  const basePrompt = systemPromptByMode(mode);
  if (compact) return `${basePrompt}\n\nUse only the minimal context needed for a concise answer.`;

  const rag = truncateText(ragText, MAX_RAG_CHARS) || '(no vector context)';
  const live = truncateText(liveText, MAX_LIVE_CHARS);
  const graph = truncateText(graphContext, MAX_GRAPH_CHARS);
  const graphPrompt = graph ? `\n\nGRAPH JSON:\n${graph}` : '';

  return `${basePrompt}\n\nCONTEXT:\n${rag}\n\nLIVE DATA:\n${live}${graphPrompt}`;
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
    graph:
      'You are in graph analysis mode. Treat attached graph JSON as the source of truth for folder/file topology only. Explain folder clusters, file groupings, and containment relationships without inventing symbols or tasks.',
    groq:
      'You are in Groq reasoning mode. If graph JSON is attached, use it as the source of truth for folder/file structure and keep the answer concise, grounded, and concrete.',
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
    const message = truncateText(body.message, MAX_USER_MESSAGE_CHARS);
    const projectId = safe(body.projectId);
    const modeInput = safe(body.mode || 'chat').toLowerCase();
    const mode = modeInput === 'auto' ? 'chat' : modeInput;
    const executionMode = safe(body.executionMode || body.actionMode || modeInput || 'confirm').toLowerCase();
    const agentId = safe(body.agentId || body.agentType);
    const historyList = Array.isArray(body.history) ? body.history : [];
    const graphContext = safe(body.graphContext || body.graph_context || body.graphJson || '');

    if (!message) return jsonError(res, 400, 'Bad request', 'message is required.');
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const allowedModes = new Set(['chat', 'plan', 'standup', 'report', 'assign', 'brief', 'graph', 'groq']);
    if (!allowedModes.has(mode)) return jsonError(res, 400, 'Bad request', 'mode must be one of chat|plan|standup|report|assign|brief|graph|groq.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const { ragText, liveText, totalChunks } = await buildContext(message, projectId, req.orgDb);
    const systemPrompt = buildSystemPrompt(mode, ragText, liveText, graphContext, false);

    const trimmedHistory = historyList
      .slice(-MAX_HISTORY_ITEMS)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && safe(m.content))
      .map((m) => ({ role: m.role, content: truncateText(m.content, MAX_HISTORY_ITEM_CHARS) }));

    const groqApiKey = process.env.GROQ_API_KEY;
    if (!safe(groqApiKey)) return jsonError(res, 500, 'Server error', 'GROQ_API_KEY is not configured.');

    let outboundMessages = [{ role: 'system', content: systemPrompt }, ...trimmedHistory, { role: 'user', content: message }];
    const tools = normalizeGroqTools(getToolDefinitions());
    let useTools = mode !== 'groq' && mode !== 'graph';
    const groqModel = resolveGroqModel();
    let firstResponse;
    try {
      firstResponse = await callGroqWithOptionalTools(groqApiKey, {
        model: groqModel,
        max_tokens: 900,
        temperature: 0.4,
        messages: outboundMessages,
      }, useTools ? tools : []);
    } catch (caught) {
      const detail = safe(caught?.message || '');
      if (!isGroqPayloadTooLargeError(detail)) throw caught;

      useTools = false;
      outboundMessages = [
        { role: 'system', content: buildSystemPrompt(mode, ragText, liveText, graphContext, true) },
        { role: 'user', content: truncateText(message, 900) },
      ];

      firstResponse = await callGroqWithOptionalTools(groqApiKey, {
        model: groqModel,
        max_tokens: 600,
        temperature: 0.3,
        messages: outboundMessages,
      }, []);
    }

    let finalText = extractText(firstResponse.choices?.[0]?.message?.content || firstResponse.content);
    if (useTools && firstResponse.choices?.[0]?.message?.tool_calls?.length) {
      const toolCalls = firstResponse.choices[0].message.tool_calls;
      const toolResults = [];

      for (const toolCall of toolCalls) {
        const result = await executeActionWithPolicy(req.orgDb, {
          projectId,
          userId: String(req.user?.userId || ''),
          executionMode,
          agentId,
        }, String(toolCall.function.name), JSON.parse(toolCall.function.arguments || '{}'));

        if (result?.type === 'confirmation_required') {
          return res.status(200).json(result);
        }

        toolResults.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          content: JSON.stringify(result || {}),
        });
      }

      const secondMessages = [
        ...outboundMessages,
        firstResponse.choices[0].message,
        ...toolResults,
      ];

      const secondResponse = await callGroqWithOptionalTools(groqApiKey, {
        model: groqModel,
        max_tokens: 900,
        temperature: 0.4,
        messages: secondMessages,
      }, useTools ? tools : []);
      finalText = extractText(secondResponse.choices?.[0]?.message?.content || secondResponse.content);
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
    const rowResp = await req.orgDb.query('SELECT project_id, agent_type FROM agent_actions WHERE id = $1 LIMIT 1', [actionId]);
    const projectId = safe(rowResp.rows[0]?.project_id);
    const agentId = safe(rowResp.rows[0]?.agent_type);
    if (!projectId) return jsonError(res, 404, 'Not found', 'Pending action not found.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const result = await confirmPendingAction(req.orgDb, {
      projectId,
      userId: String(req.user?.userId || ''),
      executionMode: 'auto',
      agentId,
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
    const plannerAgentId = safe(req.body?.agentId || 'sprint-autopilot');
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!endDate) return jsonError(res, 400, 'Bad request', 'endDate is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const sprint = await executeActionWithPolicy(req.orgDb, {
      projectId,
      userId: String(req.user?.userId || ''),
      executionMode: 'auto',
      agentId: plannerAgentId,
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

      await executeActionWithPolicy(req.orgDb, {
        projectId,
        userId: String(req.user?.userId || ''),
        executionMode: 'auto',
        agentId: plannerAgentId,
      }, 'move_tasks_to_sprint', {
        sprintId,
        taskIds: [taskId],
      });

      if (assigneeId) {
        await executeActionWithPolicy(req.orgDb, {
          projectId,
          userId: String(req.user?.userId || ''),
          executionMode: 'auto',
          agentId: plannerAgentId,
        }, 'assign_task', {
          taskId,
          developerId: assigneeId,
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
    const normalizedPath = String(upstreamPath || '').toLowerCase();
    const timeout =
      normalizedPath.includes('/agentic/sprint-build') ||
      normalizedPath.includes('/sprint-planning/plan') ||
      normalizedPath.includes('/sprint-planning/scope')
        ? 180_000
        : 30_000;

    const resp = await axios({
      method: req.method,
      url,
      headers: {
        'Content-Type': 'application/json',
      },
      data: req.body,
      timeout,
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

async function proxyQuery(req, res, next, upstreamPath) {
  try {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query || {})) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== undefined && item !== null) query.append(key, String(item));
        }
      } else if (value !== undefined && value !== null) {
        query.append(key, String(value));
      }
    }

    const url = buildAiServiceUrl(query.toString() ? `${upstreamPath}?${query.toString()}` : upstreamPath);
    const resp = await axios({
      method: req.method,
      url,
      timeout: 30_000,
      validateStatus: () => true,
    });

    res.status(resp.status).json(resp.data);
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

  gitNexusAnalyze(req, res, next) {
    return proxySse(req, res, next, '/api/v1/git-nexus/analyze');
  },

  gitNexusStatus(req, res, next) {
    return proxyJson(req, res, next, '/api/v1/git-nexus/status');
  },

  gitNexusTasks(req, res, next) {
    return proxyQuery(req, res, next, '/api/v1/git-nexus/tasks');
  },

  gitNexusImportTasks(req, res, next) {
    return proxyJson(req, res, next, '/api/v1/git-nexus/import-tasks');
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
