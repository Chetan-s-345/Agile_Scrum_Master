# Jira Parity Dashboard Implementation Notes

Date: 2026-03-18

## Scope requested

Implement missing Jira-like features in dashboard pages and document the review and implementation.

## What I reviewed

I scanned all dashboard route pages and checked docs + backend API capabilities before implementing.

### Dashboard pages discovered

- app/(dashboard)/assign/page.tsx
- app/(dashboard)/assignment/page.tsx
- app/(dashboard)/backlog/page.tsx
- app/(dashboard)/dashboard/page.tsx
- app/(dashboard)/developers/page.tsx
- app/(dashboard)/developers/[developerId]/page.tsx
- app/(dashboard)/monitoring/page.tsx
- app/(dashboard)/onboarding/page.tsx
- app/(dashboard)/profile/page.tsx
- app/(dashboard)/reports/page.tsx
- app/(dashboard)/reports/[sprintId]/page.tsx
- app/(dashboard)/scrum-master/page.tsx
- app/(dashboard)/settings/page.tsx
- app/(dashboard)/settings/billing/page.tsx
- app/(dashboard)/settings/integrations/page.tsx
- app/(dashboard)/settings/org/page.tsx
- app/(dashboard)/settings/team/page.tsx
- app/(dashboard)/skill-gap/page.tsx
- app/(dashboard)/sprint/page.tsx
- app/(dashboard)/sprint/[sprintId]/page.tsx
- app/(dashboard)/sprint/plan/page.tsx
- app/(dashboard)/sprint_plan/page.tsx
- app/(dashboard)/standup/page.tsx
- app/(dashboard)/tasks/page.tsx
- app/(dashboard)/tasks/[taskId]/page.tsx

### Product and parity references reviewed

- README.md
- docs/ISSUES.md

### Relevant frontend API routes reviewed

- app/api/tasks/route.ts
- app/api/tasks/board/[sprintId]/route.ts
- app/api/sprints/route.ts
- app/api/projects/route.ts
- app/api/projects/[projectId]/route.ts

### Relevant backend gateway routes/controllers/services reviewed

- backend/api-gateway/src/routes/task.routes.js
- backend/api-gateway/src/routes/sprint.routes.js
- backend/api-gateway/src/routes/project.routes.js
- backend/api-gateway/src/controllers/task.controller.js
- backend/api-gateway/src/controllers/sprint.controller.js
- backend/api-gateway/src/controllers/project.controller.js
- backend/api-gateway/src/services/task.service.js
- backend/api-gateway/src/services/sprint.service.js
- backend/api-gateway/src/services/project.service.js
- backend/api-gateway/src/validators/task.schemas.js
- backend/api-gateway/init.sql (backlog_items schema)

## Gaps identified versus Jira-like behavior

1. Backlog page was a static placeholder and did not show backlog items.
2. Task board filter button existed but had no actual filtering behavior.
3. Task board lacked quick filters/saved filter presets.
4. Task board lacked WIP limit visibility/warnings.
5. Standup page still uses a placeholder submit flow (no backend endpoint currently present).
6. Sprint detail and sprint report pages still show mostly raw JSON for burndown/risk sections.

## Implemented in this change

### 1) Real backlog data endpoint and page implementation

Backend:

- Added GET route for project backlog:
  - backend/api-gateway/src/routes/project.routes.js
  - New route: /api/v1/projects/:projectId/backlog
- Added controller handler:
  - backend/api-gateway/src/controllers/project.controller.js
  - New handler: listBacklog
- Added service query for backlog items:
  - backend/api-gateway/src/services/project.service.js
  - New method: listBacklog(req, projectId)
  - Includes epic and sprint labels via LEFT JOINs

Frontend API proxy:

- Added Next.js API route:
  - app/api/projects/[projectId]/backlog/route.ts
  - Proxies to gateway /api/v1/projects/:projectId/backlog

Dashboard UI:

- Replaced placeholder backlog page with working backlog management UI:
  - app/(dashboard)/backlog/page.tsx
- New features on backlog page:
  - Project picker
  - Search (title, Jira key, tags, description, epic)
  - Status/type/priority filters
  - Summary metrics: total, ready, in sprint, points
  - Backlog table with Jira key, type, priority, status, points, epic, sprint
  - Refresh action

### 2) Task board quick filters + saved filters + WIP alerts

Updated page:

- app/(dashboard)/tasks/page.tsx

Added Jira-like board features:

- Quick filter controls:
  - Search query
  - Priority filter
  - Assignee filter (all/assigned/unassigned)
  - Risk-only toggle
- Saved filter presets:
  - Save current filter set with a custom name
  - Apply/delete presets
  - Persisted in localStorage key: asm.taskBoard.filterPresets.v1
- WIP limit warnings:
  - In Progress limit 5
  - In Review limit 3
  - Blocked limit 2
  - Warning shown if raw column count exceeds limit
- Board now renders filtered tasks while keeping real WIP checks
- Stats section now shows filtered task total

### 3) Standup submit persistence + blocker task creation

Backend:

- Added standup API routes:
  - backend/api-gateway/src/routes/standup.routes.js
  - Mounted under /api/v1/standup
- Added standup controller:
  - backend/api-gateway/src/controllers/standup.controller.js
- Added standup service:
  - backend/api-gateway/src/services/standup.service.js
  - Persists standup entries to standup_entries
  - Parses raw input into completed/planned/blockers sections
  - Auto-creates blocker tasks in tasks when blockers are reported
- Added standup validators:
  - backend/api-gateway/src/validators/standup.schemas.js

Frontend:

- Added Next.js proxy route:
  - app/api/standup/route.ts
- Updated standup UI page:
  - app/(dashboard)/standup/page.tsx
  - Replaced placeholder alert with real submit flow
  - Added submission state + success/error feedback

## Validation

Changed files were checked for editor diagnostics. Hook dependency errors in backlog page were fixed by converting loaders to useCallback and updating useEffect dependencies.

## Remaining work (not implemented in this pass)

1. Rich sprint report visualizations (instead of raw JSON sections).
2. Workflow transition enforcement and configurable status columns.
3. Bulk backlog edit actions (rank drag-drop, bulk assign/labels/sprint move).
4. Saved filters shared across users (currently local browser only).

## Notes

- Existing unrelated repository changes were left untouched.
- This pass focused on highest-impact missing Jira-like dashboard capabilities using currently available data model and APIs.
