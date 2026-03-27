# Pages Guide

### Dashboard
Route: /dashboard
Who uses it: Scrum Masters, Engineering Managers

What this page shows:
The dashboard is the operational overview for sprint execution. It surfaces active sprint context, high-priority signals, and automation activity in one place. Teams use it to check delivery health before diving into specific workflows.

What you can do here:
- Review sprint status: inspect current progress and execution posture.
- Triage alerts: identify blockers and decide what needs intervention.
- Jump to action areas: navigate quickly into board, tasks, monitoring, and reports.

What happens automatically:
- Agent activity and risk signals update as task and sprint events are processed.

### Board
Route: /board
Who uses it: Developers, Scrum Masters

What this page shows:
The board provides sprint execution views using tabbed modes: Summary, Backlog, Board, Code, Timeline, Pages, and Forms. It helps teams move from planning to delivery with a shared work surface. Status transitions and sprint context are visible in one place.

What you can do here:
- Switch board tabs: move between summary, kanban, timeline, and documentation utilities.
- Update work state: change task status and maintain execution flow.
- Track sprint context: keep sprint and project filters while navigating tabs.

What happens automatically:
- Status updates feed monitoring and downstream assignment or alert workflows.

### Backlog
Route: /backlog
Who uses it: Scrum Masters, Product Managers, Developers

What this page shows:
The backlog page lists all planned and unplanned work that is not yet complete. It supports prioritization, story point editing, and sprint intake. This is where teams shape scope before execution.

What you can do here:
- Create and edit tasks: add new backlog items and maintain details.
- Prioritize scope: adjust ordering, priority, and readiness.
- Prepare sprint intake: move selected work into sprint planning.

What happens automatically:
- Imported GitHub issues and generated tasks appear here when creation policies are enabled.

### Sprint Plan
Route: /sprint-plan
Who uses it: Scrum Masters, Engineering Managers

What this page shows:
Sprint Plan organizes candidate work against team capacity. It highlights effort balance, risk posture, and planning readiness before a sprint starts. The page supports decision-making for realistic commitments.

What you can do here:
- Build a sprint scope: select tasks for the next sprint.
- Review capacity and risk: compare planned points against available team load.
- Finalize planning decisions: confirm scope before sprint activation.

What happens automatically:
- Planning metrics update as selected tasks and team load change.

### Sprints
Route: /sprints
Who uses it: Scrum Masters, Engineering Managers

What this page shows:
The sprints page lists planned, active, and completed sprint cycles. It acts as the lifecycle control point for sprint execution and historical review. Users can open sprint-specific detail pages from here.

What you can do here:
- Create and configure sprints: define dates, goal, and execution boundaries.
- Start or complete sprints: move the sprint through lifecycle states.
- Open sprint details: inspect alerts, metrics, and risk snapshots per sprint.

What happens automatically:
- Sprint lifecycle changes update velocity and risk reporting pipelines.

### Tasks
Route: /tasks
Who uses it: Developers, Scrum Masters

What this page shows:
The tasks page is the complete task inventory for a project with filtering and risk-focused views. It shows status, assignee, priority, and story point context. Teams use it for day-to-day execution and triage.

What you can do here:
- Create tasks manually: add work items directly with key fields.
- Filter operational queues: isolate by assignee, priority, status, or risk.
- Open task details: inspect and refine execution context.

What happens automatically:
- Task updates can trigger monitoring checks and assignment recalculation.

### Developers
Route: /developers
Who uses it: Engineering Managers, Admins

What this page shows:
The developers page provides developer-centric operational controls and technical tooling context. It supports visibility into team metadata, integration utilities, and delivery-support functions. It is used to keep assignment inputs reliable.

What you can do here:
- Review developer records: inspect members and metadata.
- Maintain integration tooling: manage key developer-facing setup paths.
- Validate assignment inputs: ensure skills and profile data stay current.

What happens automatically:
- Assignment outcomes improve as developer profile and skill data are kept accurate.

### Assignment
Route: /assignment
Who uses it: Scrum Masters, Engineering Managers

What this page shows:
Assignment is the control center for workload distribution. It exposes unassigned work and assignment decisions driven by scoring logic. Teams use it to automate or override placement decisions.

What you can do here:
- Run assignment now: trigger assignment for pending tasks.
- Inspect assignment outcomes: review who was chosen and why.
- Override placement: manually reassign when business context requires it.

What happens automatically:
- Auto Assigner continuously scores candidates using skill, load, and delivery signals.

### Monitoring
Route: /monitoring
Who uses it: Scrum Masters, Engineering Managers

What this page shows:
Monitoring surfaces active alerts, burnout indicators, and velocity signals for current execution health. It is focused on early detection and fast remediation. Teams use it for daily risk management.

What you can do here:
- Review unacknowledged alerts: inspect severity and suggested action.
- Acknowledge findings: close or act on risk notifications.
- Track burnout and capacity: monitor overload and utilization trends.

What happens automatically:
- Monitor workflows generate and deduplicate alerts from task and sprint events.

### Reports
Route: /reports
Who uses it: Scrum Masters, Engineering Managers, Leadership

What this page shows:
Reports provides sprint-level analytics such as throughput, velocity, and risk context. It supports retrospective analysis and planning calibration. Stakeholders use it to evaluate delivery performance.

What you can do here:
- Open sprint reports: inspect execution outcomes per sprint.
- Review trend signals: assess consistency, variance, and drift.
- Share delivery insights: communicate evidence-based status updates.

What happens automatically:
- Report data refreshes as sprint and task events are processed.

### Agentic Scrum Master
Route: /scrum-master
Who uses it: Scrum Masters, Engineering Managers, Admins

What this page shows:
Agentic Scrum Master is the automation control hub for project policies and agents. It includes four operational tabs: Task Factory, Auto Assigner, Monitor, and Custom Agents. Teams use it to tune autonomy and inspect decisions.

What you can do here:
- Use the Task Factory tab: control task-creation automation from issues, PRs, and webhooks.
- Use the Auto Assigner tab: run assignment now, tune behavior, and override assignments.
- Use the Monitor and Custom Agents tabs: review risk automation, logs, and custom agent actions.

What happens automatically:
- Agent state changes affect real-time behavior for task creation, assignment, and monitoring.

### GitHub
Route: /github
Who uses it: Developers, Scrum Masters, Engineering Managers

What this page shows:
The GitHub page is an integration workspace with tabs for Overview, Commits, Pull Requests, Issues, Workflows, and Branches. It centralizes repository activity in sprint context. Teams use it to bridge delivery events with task operations.

What you can do here:
- Connect and validate integration: verify repository access and sync health.
- Import issues and link PRs: tie GitHub artifacts to Sprint tasks.
- Monitor repository activity: review commits, workflows, and branch operations.

What happens automatically:
- Webhook and ingest flows sync repository events into task and monitoring pipelines.

### Webhooks
Route: /webhooks
Who uses it: Admins, Platform Operators

What this page shows:
The webhooks area focuses on operational handling of incoming integration events and dead-letter recovery. It exists for reliability management when deliveries fail or require retry. Admin users use it for diagnostics and replay control.

What you can do here:
- Inspect failed deliveries: review dead-letter webhook records.
- Retry event processing: replay selected failed events.
- Audit webhook behavior: confirm event handling outcomes.

What happens automatically:
- Webhook handlers process incoming events and route them to automation flows.

### Settings
Route: /settings
Who uses it: Admins, Scrum Masters, Team Leads

What this page shows:
Settings is the configuration hub for organization, team, profile, preferences, billing, integrations, and developer management. It centralizes control-plane configuration for the workspace. Teams use it to keep platform behavior aligned with policy.

What you can do here:
- Configure organization and team defaults: maintain membership and governance.
- Manage integrations and preferences: tune connected systems and user-level options.
- Update billing and access controls: administer plan and role settings.

What happens automatically:
- Updated policies immediately influence assignment, monitoring, and integration behavior.

### Profile
Route: /profile
Who uses it: All users

What this page shows:
Profile contains personal account data and user-level settings. It is the place for identity-level updates and account-level management links. Users keep personal context current from this page.

What you can do here:
- Update profile details: maintain name and account metadata.
- Review account context: confirm current organization linkage.
- Access billing path: navigate to plan management where available.

What happens automatically:
- Account-level updates are reflected across personalized UI context.

### Goals
Route: /goals
Who uses it: Scrum Masters, Team Leads, Engineering Managers

What this page shows:
Goals tracks progress across personal, team, and quarter views. It highlights on-track versus at-risk progress for execution outcomes. Teams use it to keep sprint work aligned with higher-level objectives.

What you can do here:
- Create and update goals: define measurable outcomes.
- Filter goal scopes: switch between all, personal, team, and quarter views.
- Track progress health: identify goals needing intervention.

What happens automatically:
- Goal metrics recompute as linked delivery progress changes.

### Pages
Route: /pages
Who uses it: All users

What this page shows:
Pages is the in-app documentation hub that links onboarding, feature, FAQ, troubleshooting, and changelog materials. It improves adoption by keeping guidance close to workflows. Users can jump directly from docs tiles to relevant product surfaces.

What you can do here:
- Open product guides: access getting-started and feature docs quickly.
- Navigate to related pages: jump from a doc topic to operational screens.
- Use docs for self-service support: reduce dependency on manual assistance.

What happens automatically:
- Documentation links remain connected to live routes and feature surfaces.

### Forms
Route: /board/forms
Who uses it: Scrum Masters, Operations users

What this page shows:
Forms provides a lightweight form builder for intake and process data collection. It supports form schema creation with typed fields and activation toggles. Current implementation stores form definitions locally as a fallback shell.

What you can do here:
- Create a form schema: define title and reusable field structure.
- Add and manage fields: include text, textarea, dropdown, checkbox, and date fields.
- Activate or deactivate forms: control form availability.

What happens automatically:
- Form definitions are persisted to local storage for immediate reuse.

### Standup
Route: /standup
Who uses it: Developers, Scrum Masters

What this page shows:
Standup captures daily progress, planned work, and blockers in a structured free-text workflow. It is designed for asynchronous updates and blocker visibility. Scrum Masters use the output for daily coordination.

What you can do here:
- Submit daily update: provide yesterday, today, and blocker context.
- Review submission feedback: confirm processing outcome.
- Iterate quickly: resend updated context when needed.

What happens automatically:
- Blocker extraction can create blocker-linked tasks during standup submission processing.

### Admin
Route: /admin/webhooks
Who uses it: Admins, Platform Operators

What this page shows:
Admin is focused on webhook reliability operations through the Admin Webhooks interface. It is used for dead-letter queue management and replay control. This page supports incident recovery for integration pipelines.

What you can do here:
- Review DLQ records: inspect failed payloads and retry history.
- Retry failed events: reprocess events after fixing root causes.
- Maintain delivery reliability: keep integration automations healthy.

What happens automatically:
- Successful retries re-enter normal webhook processing and downstream automation.
