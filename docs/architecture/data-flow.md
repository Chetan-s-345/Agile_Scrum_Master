# Data Flow Documentation

This document captures concrete, code-aligned data flows across Next.js route handlers, the API Gateway, Inngest workflows, and tenant databases.

## Flow 1: GitHub Issue -> Task -> Assignment -> Notification

Step 1: GitHub sends webhook to `POST /api/v1/webhooks/github`.
- Route binds raw body parsing for signature-safe processing.
- File: `backend/api-gateway/src/routes/webhook.routes.js`

Step 2: Gateway validates webhook signature and stores event.
- If `GITHUB_WEBHOOK_SECRET` is configured, `X-Hub-Signature-256` is validated with timing-safe HMAC SHA256 compare.
- Webhook payload is inserted into `webhook_events` in org tenant DB.
- File: `backend/api-gateway/src/controllers/webhook.controller.js`

Step 3: Gateway dispatches Task Factory event.
- For issue opened: sends `github/issue.opened` with `orgId`, `projectId`, issue metadata.
- Event dispatch uses Inngest event endpoint service.
- Files: `backend/api-gateway/src/controllers/webhook.controller.js`, `backend/api-gateway/src/services/inngestEvent.service.js`

Step 4: Inngest Task Factory receives event and deduplicates.
- Reads project policy toggles.
- Similarity check runs against `embeddings` (`vector <=>`) with threshold > 0.85 as duplicate skip.
- Files: `inngest/functions/task-factory.ts`, `backend/api-gateway/server/lib/embeddings.js`

Step 5: Task Factory creates task and updates embeddings.
- Classifies priority/type/tags, generates enriched description (Groq fallback-safe), inserts task, upserts embedding, and emits `task/created`.
- File: `inngest/functions/task-factory.ts`

Step 6: Auto Assigner consumes `task/created`.
- Scores candidates using tech match, workload, merit/weight and applies assignment + workload updates in transaction.
- Writes assignment log and action log.
- File: `inngest/functions/task-factory.ts`

Step 7: Notifications are written.
- Task/monitoring notifications are inserted into `notifications` for project leaders/assignees.
- File: `inngest/functions/task-factory.ts`

Step 8: Frontend visibility.
- UI reads through Next route handlers and API proxy; agent UI can additionally receive Socket.IO events for agent actions.
- Files: `app/api/tasks/route.ts`, `src/store/agentStore.js`, `backend/api-gateway/src/realtime/io.js`

Typical latency window:
- Webhook to task creation and assignment is generally seconds-level, depending on queue/event and LLM latency.

## Flow 2: User Sends Task to Copilot Agent

Step 1: User submits command from dashboard agent UI.
- Frontend calls Next handler `POST /api/agent/command`.
- File: `app/api/agent/command/route.ts`

Step 2: Next.js proxies as SSE to gateway.
- Handler forwards to `/api/v1/agent/command` with auth bearer from cookie.
- File: `app/api/agent/command/route.ts`, `lib/api-gateway.ts`

Step 3: Gateway starts streamed command execution.
- Route emits SSE step events (`Command received`, `Agent is reasoning`, response, done).
- Route calls internal AI chat endpoint and parses SSE text output.
- File: `backend/api-gateway/src/routes/agent.routes.js`

Step 4: Gateway persists agent action and emits realtime updates.
- Inserts into `agent_actions`.
- Broadcasts `agent:action` to project room via Socket.IO.
- Files: `backend/api-gateway/src/routes/agent.routes.js`, `backend/api-gateway/src/realtime/io.js`

Step 5: Frontend updates feed.
- Agent store listens for `agent:action` and `agent:approval` and refreshes approvals/actions on timers.
- File: `src/store/agentStore.js`

## Flow 3: Daily/Periodic Monitor Runs

There are two monitoring mechanisms running in parallel.

### 3A) Inngest Monitoring Pulse (every 30 minutes)
Step 1: Cron `*/30 * * * *` triggers `project-monitoring-pulse`.
- File: `inngest/functions/task-factory.ts`

Step 2: For each org and project, pulse computes:
- Recent GitHub event count.
- Blocked tasks, inactive tasks, overloaded developers.
- Stale blocked tasks for potential reassignment.

Step 3: Optional auto-reassignment executes.
- If policy allows (`autoAssign` and not `guardedMode`), force-reassignment attempts are made.

Step 4: Monitoring notifications are created.
- Inserts `monitoring_alert` notifications for scrum roles.
- Logs action in `agent_actions` and updates `agent_runs`.

### 3B) Gateway Internal Monitor Agents (scheduled loops)
Step 1: Gateway starts agents runtime when workers are enabled.
- File: `backend/api-gateway/src/app.js`, `backend/api-gateway/server/agents/index.js`

Step 2: Timed monitors run at UTC schedules.
- Stale task detector, sprint risk monitor, unassigned task alert, daily standup compiler, sprint completion reporter.
- File: `backend/api-gateway/server/agents/monitors.js`

Step 3: Side effects include:
- Updating sprint `riskLevel`, task `isStale`.
- Writing standups/reports.
- Sending notifications.
- Logging actions/runs in tenant DB.

## Flow 4: Sprint Risk Detection

Step 1: Risk monitor scans active sprints.
- Triggered by monitor schedule (08:00 UTC) and also surfaced by monitoring APIs.
- File: `backend/api-gateway/server/agents/monitors.js`

Step 2: Risk score logic computes gap between time consumed and work completed.
- `riskLevel` is set to `ON_TRACK`, `AT_RISK`, or `CRITICAL`.
- Sprint table is updated directly.

Step 3: Alerting and feed updates.
- Project scrum roles receive notification entries with risk summary.
- Agent actions are logged.

Step 4: API exposes risk/velocity downstream.
- Monitoring routes expose sprint velocity and alerts.
- Sprint routes expose risk and burndown endpoints.
- Files: `backend/api-gateway/src/routes/monitoring.routes.js`, `backend/api-gateway/src/routes/sprint.routes.js`

## Notes on Event + API Coordination
- User-facing APIs remain responsive by using fire-and-forget patterns for non-critical side effects where possible.
- Long-running/AI-heavy logic is distributed across Inngest, queue workers, and AI service routes.
- Cross-service consistency relies on action logs, run tables, and notification records rather than strict synchronous transactions across runtimes.