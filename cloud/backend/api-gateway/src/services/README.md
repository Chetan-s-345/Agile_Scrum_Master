# Business Logic Services

This folder contains core domain logic used by route controllers.

## Responsibilities by Area
- auth.service.js: identity, token/session, password flows.
- task.service.js: task CRUD, status transitions, comments/time logs.
- sprint.service.js: sprint lifecycle, planning, burndown/risk behavior.
- assignment.service.js: assignee scoring, candidate filtering, assignment logs.
- project.service.js: project lifecycle and automation policy.
- monitoringService.js: sprint health, alerts, capacity/burnout checks.
- github/jira service files: integration orchestration and sync behavior.
- queue/scheduler/worker helpers: background execution and retries.

## Dependency Flow
Routes -> Controllers -> Services -> DB/External APIs.

Services should avoid Express-specific concerns whenever possible so logic is testable in isolation.

## Usage Guidance
- Keep SQL parameterized.
- Keep return values structured and stable for API contracts.
- Capture side effects (notifications, sync jobs, agent events) explicitly in service methods.

## Example Pattern
- Validate required IDs and org context.
- Run transaction for multi-table writes.
- Emit optional side effects after commit.
- Return compact payload used directly by controllers.
