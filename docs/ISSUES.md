# Roadmap: Jira Parity + Agentic Scrum Master

Updated: 2026-03-15

This document is a **contributor-friendly backlog**.

- It lists missing Jira-equivalent capabilities (parity gaps).
- It also lists automation/AI features that make the product feel “agentic”.

Each work item below is written in plain terms (what/why/done). No issue-template metadata is required.

---

## How to contribute

Pick an item and implement the smallest end-to-end slice:

1. Data model + migrations (if needed)
2. API endpoints in the gateway (and/or ai-service)
3. UI wiring in Next.js
4. Basic validation + error handling
5. Update docs (this file) with what shipped

When in doubt, prefer:

- Server-enforced rules (not UI-only)
- Minimal, safe defaults (no breaking changes)
- Small PRs that land quickly

---

## Priority guide

- **P0 (Foundation / Blockers):** unblocks many features or closes a major correctness/security gap.
- **P1 (High value):** strong Jira parity or high-impact “agentic” value.
- **P2 (Nice-to-have):** improves productivity and depth.
- **P3 (Polish):** UX refinements and optional integrations.

---

## P0 — Foundation / Blockers

### Workflows: custom statuses + allowed transitions

Why it matters: A configurable workflow is the core of Jira; without it, boards and automation are shallow.

Definition of done:

- [ ] Define workflow per project: statuses + allowed transitions
- [ ] Enforce transitions server-side
- [ ] UI exposes only valid transition actions

---

### RBAC: org + project roles and permissions matrix

Why it matters: Real multi-tenant product needs consistent permission enforcement and auditability.

Definition of done:

- [ ] Define org roles + project roles (Admin/PM/Developer/Viewer)
- [ ] Permission checks enforced in API gateway
- [ ] UI hides/locks actions the user can’t perform

---

### Jira outbound sync (local → Jira)

Why it matters: Bidirectional sync is required for true Jira integration; inbound-only is incomplete.

Definition of done:

- [ ] Worker supports `jira-task-sync` jobs (not only full-sync)
- [ ] Local create/update/status change reflects in Jira
- [ ] Failure handling: retries + sync error log
- [ ] Configurable field mapping (story points, labels, priority, workflow)

---

### Platform DB alignment (tenant schema matches gateway expectations)

Why it matters: Gateway code references tables/views/functions that must exist; missing schema blocks features.

Definition of done:

- [ ] Migrations create all referenced tables/views/functions
- [ ] One-command init path for local/dev
- [ ] Core flows verified: org setup → add members → create sprint → create tasks

---

## P1 — High value (Jira parity + agentic value)

### Work hierarchy: Epics → Stories/Tasks → Sub-tasks

Why it matters: Hierarchy enables rollups, planning views, and meaningful reporting.

Definition of done:

- [ ] Data model supports epics/stories/sub-tasks + links
- [ ] UI can create and navigate the hierarchy
- [ ] Rollups (points/status) shown at Epic level

---

### Issue types per project (Bug/Story/Task/Spike)

Why it matters: Most teams need issue type schemes and consistent reporting by type.

Definition of done:

- [ ] Project-level configuration for enabled issue types
- [ ] UI pickers/validation reflect configuration
- [ ] Reports/boards can filter/group by type

---

### Custom fields + per-project field configuration

Why it matters: Custom fields make the system adaptable without forking code.

Definition of done:

- [ ] Admin can define fields (text/number/select/user/date)
- [ ] Values stored per issue
- [ ] UI renders field editors
- [ ] API supports querying/updating custom fields

---

### Search + saved filters (start simple)

Why it matters: Without search/filters, triage and reporting don’t scale.

Definition of done:

- [ ] Support a simple query language (e.g., `project=`, `status=`, `assignee=`, `label=`, `sprint=`)
- [ ] Save and share filters
- [ ] Saved filters can feed boards/dashboards

---

### Real backlog management (ordering + bulk edits)

Why it matters: Backlog grooming is daily work; it needs rank and bulk operations.

Definition of done:

- [ ] Backlog list shows type/priority/points/assignee/labels
- [ ] Rank stored server-side (drag/drop)
- [ ] Bulk update (priority/labels/assignee/move-to-sprint)

---

### Issue links + dependency awareness

Why it matters: Dependencies drive realistic planning and risk detection.

Definition of done:

- [ ] Support link types (blocks/blocked-by/relates/duplicates)
- [ ] Sprint planning can respect blockers (optional)
- [ ] Sprint dependency graph view

---

### Jira webhooks (near real-time inbound updates)

Why it matters: Webhooks reduce polling load and shorten feedback loops.

Definition of done:

- [ ] Webhook endpoints for issue updates + sprint events
- [ ] Signature/secret validation
- [ ] Updates local backlog/tasks accordingly

---

### Sync conflict rules (“source of truth”)

Why it matters: Bidirectional sync needs predictable behavior for conflicts.

Definition of done:

- [ ] Admin setting per field: Jira-wins / Local-wins / Manual
- [ ] Conflict UI when ambiguity exists

---

### Requirements → Stories generator (human-in-the-loop)

Why it matters: Turns a project brief into actionable backlog items quickly.

Definition of done:

- [ ] Input: free-text requirement/brief
- [ ] Output: backlog items with acceptance criteria and suggested tags
- [ ] Human review step before persisting items

---

### Story point estimator + feedback loop

Why it matters: Estimation is expensive; learning from historical outcomes reduces churn.

Definition of done:

- [ ] Suggest points for backlog items
- [ ] Capture “suggested vs final” for training
- [ ] Versioned model + basic evaluation metrics

---

### Standup submit + summarization + blocker ticket creation

Why it matters: Standup is a daily ritual; the agent should turn blockers into tracked work.

Definition of done:

- [ ] Standup submit API stores entries per user/day
- [ ] Summarize blockers and create/update blocker tasks
- [ ] Optional Slack ingestion (can be later)

---

### Secrets management for Jira tokens (encryption + rotation)

Why it matters: Tokens must be protected at rest; JSON-in-a-column isn’t encryption.

Definition of done:

- [ ] Encrypt credentials at rest using a server-side key
- [ ] Rotation flow

---

## P2 — Nice-to-have depth

### Boards: column mapping, WIP limits, quick filters

Definition of done:

- [ ] Columns mapped to workflow statuses
- [ ] WIP limits per column with warnings
- [ ] Quick filters (assignee, label, type, priority)

---

### Screens: configurable create/edit/view layouts

Definition of done:

- [ ] Admin config for which fields appear on create/edit/view
- [ ] Ordering + sections respected in UI

---

### Audit trail: field history

Definition of done:

- [ ] Store field-level change events
- [ ] Render history in issue detail view
- [ ] API for history retrieval

---

### Time tracking: original estimate + remaining

Definition of done:

- [ ] Store original estimate + remaining
- [ ] Time log updates remaining (configurable)
- [ ] Reports show estimate vs actual

---

### Reporting: cumulative flow, control chart, burnup

Definition of done:

- [ ] CFD for sprint
- [ ] Cycle time/control chart by issue type
- [ ] Burnup chart

---

### AI: sprint health agent (daily narrative + apply actions)

Definition of done:

- [ ] Daily summary (progress, risks, blockers, scope suggestion)
- [ ] “Apply suggestion” actions with confirmation (reassign/split/move)

---

### AI: skill-gap detection

Definition of done:

- [ ] Detect recurring missing skills (assignment failures/unassigned work)
- [ ] Recommend training/pairing/hiring signals

---

### AI: burnout prediction v2

Definition of done:

- [ ] Trend-based risk scoring over multiple sprints
- [ ] Intervention suggestions (reduce WIP, reassign, schedule PTO)

---

### AI: retrospective generator + action items

Definition of done:

- [ ] Generate retro summary from sprint metrics + standups
- [ ] Track action items with owners + due dates

---

### Integrations: Slack notifications + interactive actions

Definition of done:

- [ ] Send alerts to Slack
- [ ] Interactive actions (acknowledge / move to next sprint)

---

### GitHub integration: PR/commit linking + cycle time

Definition of done:

- [ ] Link PRs/commits to tasks
- [ ] Track cycle time and review time

---

### Versions/Releases: components + versions + release report

Definition of done:

- [ ] Project components and versions managed by admins
- [ ] Issues can be assigned component/version
- [ ] Release report for a version

---

## P3 — Polish / Optional

### Rich text editing for description/comments

Definition of done:

- [ ] Rich-text editor for description/comments
- [ ] Safe rendering with sanitization

---

### Roadmap timeline view (epics/versions)

Definition of done:

- [ ] Timeline for Epics/Versions
- [ ] Date range and progress indicators

---

### Bulk operations (transition, assign, edit)

Definition of done:

- [ ] Multi-select issues
- [ ] Apply common actions with server-side validation

---

### Automation rules engine (simple IF/THEN)

Definition of done:

- [ ] Admin UI to define triggers and actions
- [ ] Safe execution with rate limits

---

### Calendar integration for ceremonies

Definition of done:

- [ ] Create calendar events for planning/standup/retro

---

### SSO (OIDC/SAML)

Definition of done:

- [ ] OIDC login option for organizations

---

### UX: Issue detail page with tabs

Definition of done:

- [ ] Details / Comments / Time / History in one place

---

### UX: global navigation + keyboard shortcuts

Definition of done:

- [ ] Quick search and a small set of Jira-like shortcuts
