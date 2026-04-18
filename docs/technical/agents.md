# Agent System Documentation

## Overview
Sprint uses Inngest for event-driven agent orchestration. Agents are registered through `app/api/inngest/route.ts` and implemented in `inngest/functions/*`. The API gateway and webhook handlers emit events, and Inngest executes durable steps with retries and run history.

Core design goals:
- decouple web requests from long-running automation
- keep agent execution observable and replayable
- support approval-gated and autonomous behaviors per project

## Runtime Components

### Inngest client
- File: `inngest/client.ts`
- ID: `ai-sprint-manager`
- Event key: `INNGEST_EVENT_KEY`

### Function registration
- File: `inngest/functions/index.ts`
- Registered in `app/api/inngest/route.ts`

Registered functions include:
- `sprintCreatedGroqBrief`
- `githubIssueToTask`
- `githubPushToTask`
- `prToTask`
- `prMergedToDone`
- `customAgentRunObserved`
- `taskCreatedAutoAssign`
- `taskUpdatedMonitoring`
- `projectMonitoringPulse`
- `sprintEndCleanupCron`
- `sprintEndCleanupEvent`

## Agent 1: Task Factory and Lifecycle Automation

Primary file: `inngest/functions/task-factory.ts`

Responsibilities:
- transform GitHub and PR events into tasks
- classify priority/type and infer technical tags
- create assignment and action logs
- maintain agent run metadata (`agent_runs`)
- apply policy controls from `project_automation_policies` and `agent_configs`

Supporting data tables ensured at runtime:
- `agent_actions`
- `agent_runs`
- `agent_configs`
- `project_automation_policies`

### Trigger events
| Event | Source | Purpose |
|---|---|---|
| `github/issue.opened` | webhook or gateway event bridge | create task from issue |
| `github/push.received` | webhook bridge | derive or update tasks from commit context |
| `github/pr.opened` | webhook bridge | link PR metadata to tasks/work |
| `github/pr.merged` | webhook bridge | transition linked work toward done |
| `task/created` | app or agent event | auto assignment pipeline |
| `task/updated` | app event | monitoring and risk refresh |
| `monitoring/pulse` | scheduled or manual | project health sweep |

### Decision logic highlights
- `classifyPriority()` maps issue/PR text to low/medium/high/critical.
- `classifyType()` maps labels to task categories (`bug`, `feature`, `chore`, `task`).
- `inferTechTags()` converts natural language hints into normalized tags (`react`, `backend`, `sql`, `testing`, etc.).
- Story point defaults are inferred from priority when explicit sizing is absent.

### LLM usage path
- Uses Groq chat endpoint when `GROQ_API_KEY` is set.
- Falls back to deterministic description generation when unavailable.

## Agent 2: Sprint Brief Generator

File: `inngest/functions/sprint-created-groq-brief.ts`

Trigger:
- Event: `sprint/created`

Behavior:
1. Reads sprint context from event payload.
2. Calls `groqChat` with constrained prompt.
3. Returns concise planning artifacts:
   - suggested sprint goal
   - top risks
   - standup prompts
   - tracking metrics

Failure mode:
- If Groq is unavailable, the function fails at run-step level and is visible in Inngest run logs.

## Approval and Autonomy Model
- Agent execution can be governed by project policy:
  - `create_from_issue`
  - `create_from_pr`
  - `auto_assign`
  - `monitoring_enabled`
  - `guarded_mode`
- Guarded/autonomy settings are sourced from project policy and agent config rows.
- Approval workflows are exposed through gateway routes and surfaced in UI via `src/store/agentStore.js`.

## Operational Endpoints (Gateway)
Representative route groups (proxied via Next.js `app/api/*`):
- `/api/v1/agents/*`
- `/api/v1/agent/*`
- `/api/v1/sprint-autopilot/*`
- `/api/v1/webhooks/*`

Common actions:
- list status and stats
- pause/resume agent behavior
- run agent manually
- approve/reject/modify pending actions

## Observability

### Database logs
- `agent_actions`: action trail and payload/result snapshots
- `agent_runs`: last run, next run, status, and daily counts
- `webhook_events`: inbound event processing and retry/DLQ state

### Realtime feed
- Gateway emits socket events to project rooms.
- UI consumes events and periodic refresh in `src/store/agentStore.js`.

### Health and debugging checklist
1. Verify gateway `/health` and Inngest route availability.
2. Confirm event keys and webhook secrets in environment.
3. Inspect `webhook_events` for retries/DLQ.
4. Inspect `agent_runs` and `agent_actions` for failures.
5. Validate project policy values before assuming agent inactivity is a bug.

## Manual Testing Guide
1. Trigger a synthetic GitHub issue webhook.
2. Confirm `github/issue.opened` is emitted.
3. Check task creation in tenant DB.
4. Check approval/action feed endpoints.
5. Validate UI updates in agent panel and task board.

## Extension Guidelines
- Keep new events idempotent and include stable IDs.
- Store enough payload metadata to replay decisions.
- Add new policy flags with defaults and migration-safe ALTER statements.
- Ensure every autonomous action can be traced back to event + policy + run ID.
