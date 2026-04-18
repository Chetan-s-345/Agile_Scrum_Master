# Agent System Architecture

## How Inngest Works in This Project

Inngest is exposed through Next.js at `/api/inngest`, where function registrations are provided by `serve()` and signed using configured event/signing keys. Gateway services push events through the Inngest event endpoint abstraction, and selected Next routes also emit events directly (for example sprint created).

Functions are modeled as event-triggered or cron-triggered workflows. The major function set includes GitHub issue/PR/push task creation, post-creation assignment, task update monitoring, merged PR completion sync, monitoring pulse, and sprint cleanup jobs.

`step.run` boundaries in functions provide named execution checkpoints, which helps with observability and deterministic retries. Durable workflow state and run outputs are visible in Inngest runs, while business side effects are also mirrored to tenant DB action tables.

Retries are handled by Inngest per function semantics, and most functions additionally capture success/failure state in `agent_runs` and `agent_actions` for business-level observability independent of platform-level execution logs.

## Agent Decision Tree

```text
Incoming Signal
  |
  +-- github/issue.opened
  |     -> task-factory.githubIssueToTask
  |        -> policy createFromIssue disabled? yes -> log skip
  |        -> similarity > 0.85? yes -> duplicate skip
  |        -> else create task + embedding + notify + emit task/created
  |
  +-- github/pr.opened
  |     -> task-factory.prToTask
  |        -> existing linked task? move to in_review
  |        -> else create review task + emit task/created
  |
  +-- github/push
  |     -> task-factory.githubPushToTask
  |        -> actionable commit filtering
  |        -> duplicate guard + create follow-up tasks
  |
  +-- task/created
  |     -> task-factory.taskCreatedAutoAssign
  |        -> autoAssign disabled OR guardedMode? skip
  |        -> else score candidates and assign transactionally
  |
  +-- task/updated
  |     -> task-factory.taskUpdatedMonitoring
  |        -> blocked? notify + optional force reassign
  |
  +-- github/pr.merged
  |     -> task-factory.prMergedToDone
  |        -> lookup by PR number or branch code
  |        -> set done + comment + update sprint points + notify assignee
  |
  +-- cron */30 * * * *
  |     -> task-factory.projectMonitoringPulse
  |        -> blocked/inactive/overload checks
  |        -> optional auto-reassign stale blocked tasks
  |
  +-- cron 0 8 * * *
        -> task-factory.sprintEndCleanupCron
           -> move unfinished tasks to backlog
           -> mark sprint completed
```

## Agent Configuration

Agent behavior is adjustable without changing code via three primary mechanisms.

### 1) Project automation policy table
Table: `project_automation_policies`
Controls:
- `create_from_issue`
- `create_from_pr`
- `auto_assign`
- `monitoring_enabled`
- `guarded_mode`

Used by task factory as first-read policy source.

### 2) Agent config table
Table: `agent_configs`
Fields:
- `trigger_settings` JSONB
- `constraints` JSONB
- `autonomy_level`
- `context_memo`

Task factory uses this as fallback policy source when project policy row is not present.

### 3) Environment-based global knobs
Common knobs:
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
- `EMBEDDING_MODEL`, `VECTOR_DIMENSIONS`, `OPENAI_API_KEY`
- `GROQ_API_KEY`, `GROQ_MODEL`
- Scheduler/worker toggles: `ENABLE_SCHEDULER`, `ENABLE_WORKERS`

Additional hardcoded thresholds currently in code:
- Duplicate threshold: similarity > 0.85
- Monitoring overload threshold: >= 85 percent load
- Inactive task window: 3 days
- Stale blocked window: 2 days

## Agent Observability

Observability is split across platform and domain layers.

### Inngest dashboard
What to inspect:
- Function run success/failure trend
- Retries by event type
- Step timing by named `step.run`
- Payload integrity for key events (`github/issue.opened`, `task/created`)

### Tenant database operational tables
- `agent_runs`: per-agent latest execution status, next run, daily action count
- `agent_actions`: detailed action-level audit payloads and results
- `agent_approvals`: human-in-the-loop approval workflow state
- `agent_decisions`: higher-level decision records for custom agents

### Suggested production queries

```sql
-- latest agent runs
SELECT agent_name, last_run, next_run, last_status, actions_today
FROM agent_runs
ORDER BY last_run DESC;
```

```sql
-- recent failed actions
SELECT created_at, action_name, status, result
FROM agent_actions
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 100;
```

```sql
-- pending approvals
SELECT id, project_id, action_type, status, created_at
FROM agent_approvals
WHERE status = 'pending'
ORDER BY created_at DESC;
```

## Runtime Agent Planes

The system has two automation planes and both are intentional:

1) Inngest workflow agents (event and cron durable automation).
2) Gateway in-process monitors and workers (timed operational loops and queue-backed processors).

This hybrid model provides durability for event chains and operational flexibility for frequent polling/monitoring logic, at the cost of additional operational discipline and clearer runbooks.