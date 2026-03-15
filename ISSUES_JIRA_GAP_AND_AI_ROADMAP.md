# Jira Parity Gaps + AI Sprint Manager Roadmap (Issue Backlog)

Date: 2026-03-15

This backlog is derived from the current codebase structure (Next.js UI + API routes proxying to `ai-sprint-manager/backend/api-gateway`) and the visible stubs (e.g., Standup UI has no submit API). It focuses on **Jira-equivalent features that are missing** and **additional automation features** that make an “Agentic Scrum Master” feel meaningfully beyond Jira.

---

## Epic: Jira Parity (Core Work Management)

### JIRA-GAP-001 — Epics + Story hierarchy (Epic → Story → Sub-task)

**Type:** Feature
**Priority:** P1
**Labels:** jira-parity, data-model, backlog

**Problem**
Jira supports work hierarchy (epics, stories, tasks, sub-tasks) with rollups, reporting, and board/backlog behavior. Current model is mostly “task/backlog item” without full hierarchy.

**Acceptance Criteria**

- Data model supports Epics, Stories/Tasks, Sub-tasks and links between them.
- UI supports creating and viewing hierarchy, including rollups (points, status) at Epic level.
- Sprint planning can pull Stories while keeping Epic association.

---

### JIRA-GAP-002 — Issue types + configurable issue type schemes

**Type:** Feature
**Priority:** P1
**Labels:** jira-parity, configuration

**Problem**
Jira supports multiple issue types (Bug/Story/Task/Spike) and per-project configuration.

**Acceptance Criteria**

- Project-level issue type configuration (enabled types).
- Validation and UI pickers reflect configured types.
- Reporting and boards can filter by type.

---

### JIRA-GAP-003 — Workflows with custom statuses + transitions

**Type:** Feature
**Priority:** P0
**Labels:** jira-parity, workflow

**Problem**
Jira’s value is configurable workflows (statuses, transitions, validators, post-functions). Current statuses appear fixed.

**Acceptance Criteria**

- Define workflows per project (statuses + allowed transitions).
- Enforce transitions server-side.
- UI shows transition actions based on workflow.

---

### JIRA-GAP-004 — Custom fields (text/number/select/user/date) + per-project field configs

**Type:** Feature
**Priority:** P1
**Labels:** jira-parity, custom-fields

**Problem**
Jira supports custom fields that become first-class in search, screens, and reports.

**Acceptance Criteria**

- Ability to create custom fields per org (or per project).
- Field values stored per issue.
- UI renders custom field editors.
- API supports querying and updating custom fields.

---

### JIRA-GAP-005 — Screens & screen schemes (create/edit/view layout)

**Type:** Feature
**Priority:** P2
**Labels:** jira-parity, configuration, ui

**Problem**
Jira allows per-issue-type screen layouts. Current UI is static.

**Acceptance Criteria**

- Admin can configure which fields appear for create/edit/view.
- Field ordering and sections are respected in UI.

---

### JIRA-GAP-006 — Advanced search (JQL-like) + saved filters

**Type:** Feature
**Priority:** P1
**Labels:** jira-parity, search

**Problem**
Jira’s JQL and saved filters are foundational for triage and reporting.

**Acceptance Criteria**

- Support a query language (start simple: `project=`, `status=`, `assignee=`, `label=`, `sprint=`).
- Save and share filters.
- Use saved filters as inputs for boards/dashboards.

---

### JIRA-GAP-007 — Backlog management UI (real backlog list, ordering, bulk edits)

**Type:** Feature
**Priority:** P1
**Labels:** jira-parity, backlog, ui

**Problem**
Current Backlog page is an instructional shell; Jira has backlog ordering, bulk ops, and grooming.

**Acceptance Criteria**

- Backlog shows items with type/priority/points/assignee/labels.
- Drag-and-drop ordering (rank) stored server-side.
- Bulk update (priority, labels, assignee, move to sprint).

---

### JIRA-GAP-008 — Sprint board parity (swimlanes, WIP limits, quick filters)

**Type:** Feature
**Priority:** P2
**Labels:** jira-parity, board

**Problem**
Jira boards offer swimlanes, WIP limits, quick filters, and column mappings.

**Acceptance Criteria**

- Configurable columns mapped to workflow statuses.
- WIP limit per column with warnings.
- Quick filters (assignee, label, type, priority).

---

### JIRA-GAP-009 — Issue links (blocks/blocked by/relates/duplicates) + dependency graph

**Type:** Feature
**Priority:** P1
**Labels:** jira-parity, dependencies

**Problem**
Jira supports issue linking and dependency visibility.

**Acceptance Criteria**

- Link types supported with directionality.
- Sprint planner respects blockers (optional “must schedule prerequisites first”).
- Dependency graph view for a sprint.

---

### JIRA-GAP-010 — Attachments (upload, permissions, virus-scan hook)

**Type:** Feature
**Priority:** P2
**Labels:** jira-parity, attachments

**Problem**
Jira supports attachments on issues and comments.

**Acceptance Criteria**

- Upload/download attachments and list them on the issue.
- Permission checks for who can view/download.

---

### JIRA-GAP-011 — Mentions, watchers, and notifications

**Type:** Feature
**Priority:** P2
**Labels:** jira-parity, notifications

**Problem**
Jira has @mentions, watchers, and a notification scheme.

**Acceptance Criteria**

- Mention parsing in comments (e.g., `@name`).
- Watch/unwatch issues.
- Notification preferences and delivery via email/Slack.

---

### JIRA-GAP-012 — Role-based permissions matrix (project roles, permissions)

**Type:** Feature
**Priority:** P0
**Labels:** jira-parity, security, rbac

**Problem**
Jira permissions are granular. Current roles exist but are limited.

**Acceptance Criteria**

- Define org roles + project roles (e.g., Admin, PM, Developer, Viewer).
- Permissions matrix enforced server-side.
- UI hides unauthorized actions.

---

### JIRA-GAP-013 — Audit trail for issue changes (field history)

**Type:** Feature
**Priority:** P2
**Labels:** jira-parity, audit

**Problem**
Jira shows issue history (who changed what and when).

**Acceptance Criteria**

- Store field-level change events.
- Render change history in issue detail view.
- Provide API to query history.

---

### JIRA-GAP-014 — Components, Versions/Releases, and Fix Version

**Type:** Feature
**Priority:** P2
**Labels:** jira-parity, release-management

**Problem**
Jira supports components and versions for planning and release notes.

**Acceptance Criteria**

- Project components and versions managed by admins.
- Issues can be assigned components/versions.
- Release report for a version.

---

### JIRA-GAP-015 — Roadmap view (timeline by epics/versions)

**Type:** Feature
**Priority:** P2
**Labels:** jira-parity, roadmap

**Problem**
Jira’s roadmap is key for stakeholders.

**Acceptance Criteria**

- Timeline for Epics/Versions.
- Date range and progress indicators.

---

### JIRA-GAP-016 — Granular time tracking (remaining estimate, original estimate)

**Type:** Feature
**Priority:** P2
**Labels:** jira-parity, time-tracking

**Problem**
Current time logging exists, but Jira also supports estimates and remaining tracking.

**Acceptance Criteria**

- Store original estimate + remaining.
- Time log updates remaining (configurable).
- Reports show estimate vs actual.

---

### JIRA-GAP-017 — Full Agile report parity (cumulative flow, control chart, velocity, burnup)

**Type:** Feature
**Priority:** P2
**Labels:** jira-parity, reporting

**Problem**
You have some velocity/burndown-like functionality; Jira provides a broader suite.

**Acceptance Criteria**

- Cumulative Flow Diagram for sprint.
- Cycle time / control chart by issue type.
- Burnup chart.

---

### JIRA-GAP-018 — Confluence-like rich text editing (description/comments)

**Type:** Feature
**Priority:** P3
**Labels:** jira-parity, editor

**Problem**
Jira uses a rich doc format (ADF) for descriptions/comments; current text fields are plain.

**Acceptance Criteria**

- Rich-text editor for description/comments.
- Safe rendering with sanitization.

---

### JIRA-GAP-019 — Bulk operations (transition, assign, edit fields)

**Type:** Feature
**Priority:** P2
**Labels:** jira-parity, productivity

**Problem**
Jira supports bulk changes for triage and sprint prep.

**Acceptance Criteria**

- Select multiple issues and apply common actions.
- Server validates permissions and workflow transitions.

---

### JIRA-GAP-020 — Automation rules engine (IF/THEN triggers)

**Type:** Feature
**Priority:** P2
**Labels:** jira-parity, automation

**Problem**
Jira Automation is a major differentiator; current system has workers but not user-configurable rules.

**Acceptance Criteria**

- Admin UI to define triggers (status change, scheduled, sprint start/end) and actions (comment, assign, notify).
- Server executes rules safely with rate limits.

---

## Epic: Jira Integration Parity (Bidirectional Sync)

### INT-JIRA-001 — Outbound Jira sync (create/update/status/transition)

**Type:** Feature
**Priority:** P0
**Labels:** jira, integration, sync

**Problem**
Inbound sync exists (backlog + active sprint) and the code queues “jira-task-sync” jobs, but the worker only processes `full-sync`. Outbound syncing is not implemented.

**Acceptance Criteria**

- Worker supports `jira-task-sync` jobs.
- Local task create/update/status change is reflected in Jira.
- Field mapping configurable (story points, labels, priority, status/workflow).
- Failure handling with retry/backoff and a sync error log.

---

### INT-JIRA-002 — Jira webhooks (near real-time inbound updates)

**Type:** Feature
**Priority:** P1
**Labels:** jira, integration, webhooks

**Problem**
Polling/scheduled sync is slower and costlier than webhooks.

**Acceptance Criteria**

- Webhook endpoint(s) for issue created/updated/deleted and sprint events.
- Signature/secret validation.
- Updates local backlog/tasks accordingly.

---

### INT-JIRA-003 — Jira field discovery UI (pick story points field + board by browsing)

**Type:** Feature
**Priority:** P2
**Labels:** jira, integration, ux

**Problem**
Users currently must manually enter boardId and custom field ids.

**Acceptance Criteria**

- Fetch and list Jira boards for the project.
- Fetch and list custom fields; select story points field.
- Save selections to integration config.

---

### INT-JIRA-004 — Sync conflict resolution + “source of truth” settings

**Type:** Feature
**Priority:** P1
**Labels:** jira, integration

**Problem**
Bidirectional sync needs clear conflict rules.

**Acceptance Criteria**

- Admin setting per field: Jira-wins / Local-wins / Manual.
- Show conflict UI when ambiguity exists.

---

## Epic: Data Model & Platform Readiness (Needed for Many Features)

### PLATFORM-001 — Align tenant DB schema with API gateway code

**Type:** Bug/Chore
**Priority:** P0
**Labels:** database, migrations

**Problem**
API gateway code references tables/views like `team_members`, `developer_profiles`, `backlog_items`, `org_settings`, `org_audit_log`, `v_team_capacity`, and functions like `calculate_merit_score`, which do not appear in the current tenant schema SQL files. This blocks many features.

**Acceptance Criteria**

- Introduce migrations that create all referenced tables/views/functions.
- Add a one-command init path for local/dev.
- Verify that core flows (org setup → add members → create sprint → create tasks) have the required schema.

---

### PLATFORM-002 — Seed data and “first run” setup wizard

**Type:** Feature
**Priority:** P2
**Labels:** onboarding

**Problem**
New orgs need guided setup (project, workflow, Jira connect, team capacity).

**Acceptance Criteria**

- Step-by-step wizard to configure minimum viable org settings.
- Seed sample data optional.

---

### PLATFORM-003 — Observability (structured logs + request tracing)

**Type:** Chore
**Priority:** P2
**Labels:** observability

**Problem**
As workflows become agentic, debugging needs tracing.

**Acceptance Criteria**

- Correlation ids for API requests and background jobs.
- Basic metrics (job latency, sync success rate).

---

## Epic: AI/Automation (Beyond Jira)

### AI-001 — Requirement → User Story generator (title, description, AC, subtasks)

**Type:** Feature
**Priority:** P1
**Labels:** ai, backlog

**Problem**
README describes a requirement-to-story converter, but no user-facing flow exists.

**Acceptance Criteria**

- Input: free-text requirement.
- Output: one or more backlog items with acceptance criteria and suggested tech tags.
- Human review step before creating items.

---

### AI-002 — Story point estimator (model + feedback loop)

**Type:** Feature
**Priority:** P1
**Labels:** ai, estimation

**Problem**
Estimation is a core time sink; current points appear manual or taken from Jira.

**Acceptance Criteria**

- Suggest points for backlog items/tasks.
- Capture “final points” vs “suggested points” for training.
- Versioned model and evaluation metrics.

---

### AI-003 — Sprint auto-planner v2 (dependencies, risks, tech balance)

**Type:** Feature
**Priority:** P2
**Labels:** ai, sprint-planning

**Problem**
Current sprint planning scores by priority + business value and capacity. Add realistic constraints.

**Acceptance Criteria**

- Consider dependencies/blocks links.
- Penalize high-risk items when capacity tight.
- Ensure distribution across tech stacks (avoid one person bottleneck).

---

### AI-004 — Standup ingestion + summarization + blocker ticket creation

**Type:** Feature
**Priority:** P1
**Labels:** ai, standup, slack

**Problem**
Standup page is a UI shell and shows “endpoint not implemented”.

**Acceptance Criteria**

- Standup submit API stores entries per user/day.
- Summarize blockers and create/update blocker tasks.
- Optional Slack ingestion.

---

### AI-005 — Sprint health agent (daily narrative + actionable recommendations)

**Type:** Feature
**Priority:** P2
**Labels:** ai, monitoring

**Problem**
You have velocity gap calculations and alerts; the next step is explainability and actions.

**Acceptance Criteria**

- Daily generated summary: progress, risks, blockers, suggested scope change.
- “Apply suggestion” actions (move tasks, reassign, split work) with confirmation.

---

### AI-006 — Skill-gap detection from task requirements vs team skill matrix

**Type:** Feature
**Priority:** P2
**Labels:** ai, skill-gap

**Problem**
A skill-gap page exists but the full workflow (detect → recommend training/hiring) isn’t complete.

**Acceptance Criteria**

- Detect recurring missing skills when assignment fails or tasks remain unassigned.
- Recommend training plan, pairing suggestions, or hiring signals.

---

### AI-007 — Burnout prediction v2 (trend + intervention playbooks)

**Type:** Feature
**Priority:** P2
**Labels:** ai, wellbeing

**Problem**
Burnout exists as a flag/list; improve prediction and recommended interventions.

**Acceptance Criteria**

- Trend-based risk scoring over multiple sprints.
- Intervention suggestions (reduce WIP, reassign, schedule PTO).

---

### AI-008 — Retrospective generator (wins, misses, action items)

**Type:** Feature
**Priority:** P2
**Labels:** ai, retro

**Problem**
Automated retros are a strong “beyond Jira” capability.

**Acceptance Criteria**

- Generate retro summary from sprint metrics + comments + standups.
- Track action items with owners and due dates.

---

### AI-009 — Release notes + stakeholder summary (per sprint/version)

**Type:** Feature
**Priority:** P3
**Labels:** ai, reporting

**Problem**
Stakeholders want digestible updates.

**Acceptance Criteria**

- Generate a changelog-style summary of completed work.
- Export to email/Slack/Confluence.

---

## Epic: Integrations (Beyond Jira)

### INT-001 — Slack notifications + interactive actions (ack alerts, approve plan)

**Type:** Feature
**Priority:** P2
**Labels:** slack, notifications

**Acceptance Criteria**

- Send alerts to a channel and allow “Acknowledge” / “Move to next sprint” actions.

---

### INT-002 — GitHub integration (PR/commit linking, cycle time)

**Type:** Feature
**Priority:** P2
**Labels:** github, metrics

**Acceptance Criteria**

- Link PRs/commits to tasks.
- Track cycle time and review time.

---

### INT-003 — Calendar integration for sprint ceremonies

**Type:** Feature
**Priority:** P3
**Labels:** calendar

**Acceptance Criteria**

- Create calendar events for planning/standup/retro.

---

## Epic: Security & Admin

### SEC-001 — SSO (OIDC/SAML) for organizations

**Type:** Feature
**Priority:** P3
**Labels:** security, sso

**Acceptance Criteria**

- OIDC login option for orgs.

---

### SEC-002 — Secrets management for Jira tokens (encryption + rotation)

**Type:** Security
**Priority:** P1
**Labels:** security, jira

**Problem**
Jira tokens are stored as JSON in a field called `api_token_encrypted` (not truly encrypted).

**Acceptance Criteria**

- Encrypt credentials at rest using a server-side key.
- Rotation flow.

---

## Epic: UX Polish (Quality-of-life parity)

### UX-001 — Issue detail page with tabs (Details, Comments, Time, History)

**Type:** Feature
**Priority:** P2
**Labels:** ui

**Acceptance Criteria**

- Single place to view/edit all issue info.

---

### UX-002 — Global navigation and keyboard shortcuts (Jira-like)

**Type:** Feature
**Priority:** P3
**Labels:** ui, productivity

**Acceptance Criteria**

- `/` opens quick search; `g b` goes to backlog; etc.

---

# Notes

- This file is intended to be copy-pastable into GitHub Issues / Azure DevOps as individual issues.
- If you want, I can also split these into separate `.md` files (one per issue) or output CSV for bulk import.
