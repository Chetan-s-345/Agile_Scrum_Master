# Features

## Task Management
Tasks are created in two ways: manually by users from pages such as `/tasks` and `/backlog`, and automatically from integration or agent workflows (for example GitHub issue ingestion and standup blocker extraction). Automatic creation uses context-aware parsing and duplicate checks before insert.

Task fields and meaning:
- id: unique internal task identifier.
- code: human-readable task code, typically `SCRUM-N`.
- title: short summary of the work item.
- description: detailed execution context.
- status: current lifecycle state.
- priority: urgency classification (low, medium, high, critical).
- storyPoints: effort estimate used for planning and capacity.
- assigneeId: current owner.
- sprintId: sprint linkage, or null when in backlog.
- projectId: owning project.
- githubIssueNumber / linked metadata: source traceability for external systems.
- createdAt / updatedAt: audit timestamps.

Task statuses and common transitions:
- TODO: new or queued work.
- IN_PROGRESS: active implementation work.
- IN_REVIEW: work is complete and awaiting review or merge.
- DONE: accepted as finished.
- BLOCKED: cannot proceed due to dependency/risk.
Transitions are triggered by board/task edits, assignment events, and integration updates (such as linked PR movement or merge events).

Task code format (`SCRUM-N`) is generated sequentially by project context. The system checks the highest existing SCRUM code and increments the numeric suffix for the next created item.

## Sprint Management
Create a sprint from `/sprints` or `/sprint-plan` by defining name, dates, and sprint goal. Scope is assembled by selecting backlog tasks and balancing effort against available team capacity.

Add tasks to sprint by selecting backlog items and associating them with the target sprint. You can do this during planning or later when scope changes are required.

Start a sprint by moving it from planned to active state, which activates sprint-level monitoring and dashboard/report context.

Complete sprint finalizes the active cycle and closes execution tracking for that sprint. Incomplete tasks are handled by carry-over logic through planning controls so unfinished work can be moved into the next planning cycle.

Sprint health indicators combine velocity, active alert severity, stale task patterns, and capacity/burnout pressure to reflect delivery risk posture.

## Agent System
### Task Factory Agent
Task Factory is triggered by GitHub issue/pr events, webhook deliveries, and task-related automation signals. It can also process standup blocker-derived context depending on workflow entry points.

It creates structured tasks, enriched context, and downstream events for assignment and monitoring. It also records decision artifacts for traceability.

Deduplication uses semantic similarity checks and threshold guards before task creation. In code, duplicate candidates above the high-confidence threshold are skipped to prevent redundant backlog noise.

### Auto Assigner Agent
Auto Assigner computes a developer score for each candidate and selects the best-fit assignee. Scoring is based on skill alignment, current load/utilization, and throughput/performance signals.

Skill match maps task requirements to developer skill metadata and contribution history. Better skill overlap increases assignment confidence.

Availability scoring penalizes overloaded developers and favors balanced distribution to avoid burnout and bottlenecks.

Override assignment from `/assignment` or task actions when business context requires manual control.

### Monitor Agent
Monitor runs continuously through scheduled pulses and event-driven updates. It checks sprint velocity gaps, stale tasks, workload pressure, and unresolved alerts.

Stale task detection identifies tasks that have not moved within expected windows and raises actionable alerts.

Risk levels are interpreted as:
- ON_TRACK: delivery trajectory is healthy.
- AT_RISK: execution drift is emerging and needs attention.
- CRITICAL: immediate intervention required to protect sprint outcome.

PR review nudges are triggered when tasks or linked PR activity indicate review latency that threatens sprint flow.

## GitHub Integration
Connect repository access from `/github` or integration settings, then authorize organization/repository permissions. Sprint stores integration context and begins sync workflows after successful connection.

What syncs automatically:
- Issues and issue updates.
- Pull request metadata and state changes.
- Commit/workflow/branch context used by project visibility surfaces.
- Webhook event history used for automation pipelines.

PRs link to tasks by explicit mapping actions and by task code references (for example SCRUM identifiers) in PR metadata and related activity.

Copilot coding agent workflow is exposed through task-level actions and agent surfaces so teams can send execution context into assisted coding flows and track outcomes.

## Reporting
Reports summarize sprint delivery outcomes, velocity signals, and risk context across current and historical sprints.

Burndown chart interpretation:
- A smooth downward line indicates consistent scope burn.
- Flat segments indicate little completion movement.
- Upward shifts usually indicate scope increase or carry-in work.

Velocity chart interpretation:
- Stable velocity suggests predictable planning quality.
- High variance suggests unstable scope, sizing, or team load.
- Downward trend suggests emerging process or capacity issues.

Risk levels in reporting should be read as execution confidence indicators, not just status labels. Combine risk with velocity and alert context before making scope decisions.
