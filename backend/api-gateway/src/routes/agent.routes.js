const express = require('express');
const { randomUUID } = require('node:crypto');

const { authMiddleware } = require('../middleware/auth');
const { orgDbMiddleware } = require('../middleware/orgDb');
const { env } = require('../config/env');
const { ensureAgentActionsTable, ensureAgentApprovalsTable, executeCoreAction } = require('../../server/lib/agentActions');
const { emitToProject } = require('../realtime/io');

const router = express.Router();
router.use(authMiddleware, orgDbMiddleware);

function safe(value) {
  return String(value || '').trim();
}

function jsonError(res, status, error, detail) {
  return res.status(status).json({ error, code: status, detail });
}

function mapAgentToMode(agentType) {
  const key = safe(agentType).toLowerCase();
  if (!key || key === 'all agents') return 'chat';
  if (key === 'sprint autopilot') return 'plan';
  if (key === 'developer intelligence') return 'assign';
  return 'chat';
}

function parseSseText(raw) {
  return String(raw || '')
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .filter((line) => line && line !== '[DONE]')
    .join('');
}

function setSseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function writeEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload || {})}\n\n`);
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

function coerceObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function approvalDetails(approval) {
  const payload = coerceObject(approval?.payload);
  const preview = coerceObject(payload.preview);
  return {
    payload,
    preview,
    actionType: safe(payload.actionType || approval?.action_type),
    input: coerceObject(payload.input),
    reasoning: safe(payload.reasoning || preview.reasoning || preview.summary || approval?.description),
    dataUsed: coerceObject(payload.dataUsed || preview.dataUsed),
    impactPreview: safe(payload.impactPreview || preview.impactPreview || preview.impact),
  };
}

async function updateApprovalAndAction(orgDb, approvalId, updates, actionStatus, actionResult) {
  await orgDb.query(
    `UPDATE agent_approvals
     SET status = COALESCE($2, status),
         decided_by = COALESCE($3, decided_by),
         decided_at = COALESCE($4, decided_at),
         resolved_by = COALESCE($5, resolved_by),
         resolved_at = COALESCE($6, resolved_at),
         resolution_note = COALESCE($7, resolution_note),
         modified_params = COALESCE($8::jsonb, modified_params),
         execution_result = COALESCE($9::jsonb, execution_result)
     WHERE id = $1`,
    [
      String(approvalId),
      updates.status || null,
      updates.decidedBy || null,
      updates.decidedAt || null,
      updates.resolvedBy || null,
      updates.resolvedAt || null,
      updates.resolutionNote || null,
      updates.modifiedParams ? JSON.stringify(updates.modifiedParams) : null,
      updates.executionResult ? JSON.stringify(updates.executionResult) : null,
    ]
  );

  await ensureAgentActionsTable(orgDb);
  await orgDb.query(
    `INSERT INTO agent_actions (id, project_id, user_id, action_name, input, result, status)
     SELECT id, project_id, $2, action_type, payload, $3::jsonb, $4
     FROM agent_approvals
     WHERE id = $1
     ON CONFLICT (id) DO UPDATE
     SET status = EXCLUDED.status,
         result = EXCLUDED.result`,
    [String(approvalId), String(updates.resolvedBy || updates.decidedBy || ''), JSON.stringify(actionResult || {}), String(actionStatus)]
  );
}

router.get('/approvals', async (req, res, next) => {
  try {
    const projectId = safe(req.query.projectId);
    const status = safe(req.query.status).toLowerCase();
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    await ensureAgentApprovalsTable(req.orgDb);
    const allowedStatus = new Set(['pending', 'approved', 'modified', 'rejected', 'failed']);
    const hasStatus = allowedStatus.has(status);

    const rows = hasStatus
      ? await req.orgDb.query(
          `SELECT id, project_id, action_type, title, description, payload, status,
                  decided_by, decided_at, resolved_by, resolved_at, resolution_note,
                  modified_params, execution_result, created_at
           FROM agent_approvals
           WHERE project_id = $1 AND status = $2
           ORDER BY created_at DESC
           LIMIT 200`,
          [projectId, status]
        )
      : await req.orgDb.query(
          `SELECT id, project_id, action_type, title, description, payload, status,
                  decided_by, decided_at, resolved_by, resolved_at, resolution_note,
                  modified_params, execution_result, created_at
           FROM agent_approvals
           WHERE project_id = $1
           ORDER BY created_at DESC
           LIMIT 200`,
          [projectId]
        );

    return res.status(200).json({ approvals: rows.rows });
  } catch (err) {
    return next(err);
  }
});

router.post('/approvals/:id/approve', async (req, res, next) => {
  try {
    const approvalId = safe(req.params.id);
    if (!approvalId) return jsonError(res, 400, 'Bad request', 'approval id is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    await ensureAgentApprovalsTable(req.orgDb);
    const rowResp = await req.orgDb.query('SELECT * FROM agent_approvals WHERE id = $1 LIMIT 1', [approvalId]);
    const approval = rowResp.rows[0];
    if (!approval) return jsonError(res, 404, 'Not found', 'Approval request not found.');
    if (safe(approval.status) !== 'pending') return jsonError(res, 409, 'Conflict', 'Approval has already been decided.');

    const projectId = safe(approval.project_id);
    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const details = approvalDetails(approval);
    const resolvedBy = String(req.user?.userId || '');
    const resolvedAt = new Date().toISOString();

    let executionResult;
    try {
      executionResult = await executeCoreAction(req.orgDb, {
        projectId,
        userId: resolvedBy,
        executionMode: 'auto',
      }, details.actionType, details.input);
    } catch (err) {
      const detail = safe(err?.message) || 'Action execution failed.';
      await updateApprovalAndAction(req.orgDb, approvalId, {
        status: 'failed',
        decidedBy: resolvedBy,
        decidedAt: resolvedAt,
        resolvedBy,
        resolvedAt,
        resolutionNote: detail,
        executionResult: { error: detail },
      }, 'failed', { error: detail });
      emitToProject(projectId, 'agent:action', {
        id: approvalId,
        projectId,
        actionName: `Human approved: ${details.actionType}`,
        status: 'failed',
        result: { error: detail },
        createdAt: resolvedAt,
      });
      return jsonError(res, 500, 'Server error', detail);
    }

    await updateApprovalAndAction(req.orgDb, approvalId, {
      status: 'approved',
      decidedBy: resolvedBy,
      decidedAt: resolvedAt,
      resolvedBy,
      resolvedAt,
      resolutionNote: 'Approved as-is',
      executionResult,
    }, 'executed', executionResult);

    emitToProject(projectId, 'agent:action', {
      id: approvalId,
      projectId,
      actionName: `Human approved: ${details.actionType}`,
      status: 'executed',
      result: executionResult,
      createdAt: resolvedAt,
    });

    return res.status(200).json({ success: true, result: executionResult });
  } catch (err) {
    return next(err);
  }
});

router.post('/approvals/:id/modify', async (req, res, next) => {
  try {
    const approvalId = safe(req.params.id);
    const modifiedParams = coerceObject(req.body?.modifiedParams);
    if (!approvalId) return jsonError(res, 400, 'Bad request', 'approval id is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    await ensureAgentApprovalsTable(req.orgDb);
    const rowResp = await req.orgDb.query('SELECT * FROM agent_approvals WHERE id = $1 LIMIT 1', [approvalId]);
    const approval = rowResp.rows[0];
    if (!approval) return jsonError(res, 404, 'Not found', 'Approval request not found.');
    if (safe(approval.status) !== 'pending') return jsonError(res, 409, 'Conflict', 'Approval has already been decided.');

    const projectId = safe(approval.project_id);
    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const details = approvalDetails(approval);
    const resolvedBy = String(req.user?.userId || '');
    const resolvedAt = new Date().toISOString();
    const baseInput = details.input;
    const mergedInput = Object.prototype.hasOwnProperty.call(modifiedParams, 'input')
      ? coerceObject(modifiedParams.input)
      : { ...baseInput, ...modifiedParams };

    let executionResult;
    try {
      executionResult = await executeCoreAction(req.orgDb, {
        projectId,
        userId: resolvedBy,
        executionMode: 'auto',
      }, details.actionType, mergedInput);
    } catch (err) {
      const detail = safe(err?.message) || 'Modified action execution failed.';
      await updateApprovalAndAction(req.orgDb, approvalId, {
        status: 'failed',
        decidedBy: resolvedBy,
        decidedAt: resolvedAt,
        resolvedBy,
        resolvedAt,
        resolutionNote: detail,
        modifiedParams,
        executionResult: { error: detail },
      }, 'failed', { error: detail });
      emitToProject(projectId, 'agent:action', {
        id: approvalId,
        projectId,
        actionName: `Human modified+approved: ${details.actionType}`,
        status: 'failed',
        result: { error: detail },
        createdAt: resolvedAt,
      });
      return jsonError(res, 500, 'Server error', detail);
    }

    await updateApprovalAndAction(req.orgDb, approvalId, {
      status: 'modified',
      decidedBy: resolvedBy,
      decidedAt: resolvedAt,
      resolvedBy,
      resolvedAt,
      resolutionNote: 'Approved with changes',
      modifiedParams,
      executionResult,
    }, 'executed', executionResult);

    emitToProject(projectId, 'agent:action', {
      id: approvalId,
      projectId,
      actionName: `Human modified: ${details.actionType}`,
      status: 'executed',
      result: executionResult,
      createdAt: resolvedAt,
    });

    return res.status(200).json({ success: true, result: executionResult });
  } catch (err) {
    return next(err);
  }
});

router.post('/approvals/:id/reject', async (req, res, next) => {
  try {
    const approvalId = safe(req.params.id);
    const reason = safe(req.body?.reason) || 'Rejected by reviewer';
    if (!approvalId) return jsonError(res, 400, 'Bad request', 'approval id is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    await ensureAgentApprovalsTable(req.orgDb);
    const rowResp = await req.orgDb.query('SELECT * FROM agent_approvals WHERE id = $1 LIMIT 1', [approvalId]);
    const approval = rowResp.rows[0];
    if (!approval) return jsonError(res, 404, 'Not found', 'Approval request not found.');
    if (safe(approval.status) !== 'pending') return jsonError(res, 409, 'Conflict', 'Approval has already been decided.');

    const projectId = safe(approval.project_id);
    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    const details = approvalDetails(approval);
    const resolvedBy = String(req.user?.userId || '');
    const resolvedAt = new Date().toISOString();

    await updateApprovalAndAction(req.orgDb, approvalId, {
      status: 'rejected',
      decidedBy: resolvedBy,
      decidedAt: resolvedAt,
      resolvedBy,
      resolvedAt,
      resolutionNote: reason,
      executionResult: { rejected: true, reason },
    }, 'rejected', { rejected: true, reason });

    emitToProject(projectId, 'agent:action', {
      id: approvalId,
      projectId,
      actionName: `Human rejected: ${details.actionType}`,
      status: 'rejected',
      result: { reason },
      createdAt: resolvedAt,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/command', async (req, res, next) => {
  try {
    const projectId = safe(req.body?.projectId);
    const command = safe(req.body?.command);
    const agentType = safe(req.body?.agentType) || 'All agents';
    const actorUserId = safe(req.body?.userId) || String(req.user?.userId || '');

    if (!command) return jsonError(res, 400, 'Bad request', 'command is required.');
    if (!projectId) return jsonError(res, 400, 'Bad request', 'projectId is required.');
    if (!req.orgDb) return jsonError(res, 500, 'Server error', 'Org database is not available.');

    const access = await ensureProjectAccess(req.orgDb, projectId, req.actorMemberId, req.user?.role);
    if (!access.ok) return jsonError(res, 403, 'Forbidden', access.reason);

    setSseHeaders(res);
    writeEvent(res, { type: 'step', message: 'Command received. Preparing agent context...' });
    writeEvent(res, { type: 'step', message: `Assigning command to ${agentType}.` });

    const mode = mapAgentToMode(agentType);
    const upstreamUrl = `http://127.0.0.1:${env.PORT}/api/v1/ai/chat`;
    const upstreamResp = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: String(req.headers.authorization || ''),
      },
      body: JSON.stringify({
        projectId,
        mode,
        message: command,
        history: [],
      }),
      cache: 'no-store',
    });

    if (!upstreamResp.ok) {
      const detailText = await upstreamResp.text().catch(() => 'Agent command failed.');
      writeEvent(res, { type: 'error', message: safe(detailText) || 'Agent command failed.' });
      writeEvent(res, { type: 'done' });
      res.write('data: [DONE]\n\n');
      res.end();
      return undefined;
    }

    writeEvent(res, { type: 'step', message: 'Agent is reasoning over sprint context...' });
    const upstreamText = await upstreamResp.text();
    const finalText = parseSseText(upstreamText);

    const actionsTaken = finalText
      .split('\n')
      .map((line) => safe(line.replace(/^[-*]\s*/, '')))
      .filter(Boolean)
      .slice(0, 5);

    writeEvent(res, { type: 'response', reasoning: finalText, actionsTaken });

    await ensureAgentActionsTable(req.orgDb);
    const eventId = randomUUID();
    await req.orgDb.query(
      `INSERT INTO agent_actions (id, project_id, user_id, action_name, input, result, status)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
      [
        eventId,
        String(projectId),
        String(actorUserId),
        'agent_command',
        JSON.stringify({ command, agentType, mode }),
        JSON.stringify({ reasoning: finalText, actionsTaken }),
        'executed',
      ]
    );

    emitToProject(projectId, 'agent:action', {
      id: eventId,
      projectId,
      actionName: 'agent_command',
      status: 'executed',
      result: { command, agentType, reasoning: finalText, actionsTaken },
      createdAt: new Date().toISOString(),
    });

    writeEvent(res, { type: 'done' });
    res.write('data: [DONE]\n\n');
    res.end();
    return undefined;
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
