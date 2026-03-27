# System Architecture

## Overview
Sprint is a monorepo with three runtime layers: a Next.js web app, a Node.js API gateway, and a Python AI service. The Next.js app provides UI routes under `app/` and also hosts BFF-style API handlers under `app/api/*` that validate browser auth cookies and proxy requests to the API gateway.

The API gateway (`backend/api-gateway`) is the system boundary for core business logic. It handles JWT auth, org-scoped database access, webhook ingestion, queue-backed background jobs, and Socket.IO project rooms for real-time updates. Most routes are mounted under `/api/v1/*` and protected by `authMiddleware` plus `orgDbMiddleware`.

The AI service (`backend/ai-service`) is a FastAPI service for planning, autonomous workflows, and ML endpoints. Event-driven automation is powered by Inngest (`inngest/`) using durable functions triggered by webhook and application events such as `github/issue.opened` and `task/updated`.

## Component Map

### Frontend (Next.js App Router)
- Entry layout: `app/layout.tsx`
- UI pages: `app/(dashboard)/*`, `app/auth/*`, marketing pages in `app/features`, `app/pricing`, `app/solution`, etc.
- State management:
  - `src/store/agentStore.js` for agent feed, approvals, and Socket.IO updates.
  - `lib/ui-store.ts` for sidebar state.
  - `lib/theme-store.ts` for persisted light/dark theme.
- API communication:
  - BFF route handlers in `app/api/*/route.ts`
  - Proxy utilities in `lib/api-gateway.ts`
- Realtime:
  - `socket.io-client` in `src/store/agentStore.js`
  - joins `project:<projectId>` room via gateway

### Backend (API Gateway)
- Entry point: `backend/api-gateway/src/app.js`
- Middleware stack:
  - `helmet`, `cors`, `morgan`
  - `authMiddleware` in `src/middleware/auth.js`
  - `orgDbMiddleware` in `src/middleware/orgDb.js`
- Route groups include:
  - auth, org, developers, projects, sprints, tasks, assignment, reports
  - webhooks (GitHub and Jira), integrations, monitoring, metrics
  - agents, agent commands, sprint autopilot, developer tools, spaces, teams
- Workers and scheduler:
  - queue workers in `src/workers/*`
  - repeatable jobs and retry workers in `src/services/schedulerService.js` and `src/jobs/*`
- Realtime:
  - Socket.IO server in `src/app.js`
  - IO helpers in `src/realtime/io`

### AI Service (FastAPI)
- Entry point: `backend/ai-service/app/main.py`
- Routers:
  - sprint planning
  - agentic sprint build
  - autonomous endpoints
  - Groq features
  - ML endpoints
- Startup behavior:
  - attempts to create ML schema via `ensure_ml_schema()`

### Inngest Agent System
- Client config: `inngest/client.ts`
- Registration endpoint: `app/api/inngest/route.ts`
- Functions:
  - `inngest/functions/task-factory.ts`
  - `inngest/functions/sprint-created-groq-brief.ts`
- Event examples:
  - `github/issue.opened`
  - `github/push.received`
  - `github/pr.opened`
  - `github/pr.merged`
  - `task/created`
  - `task/updated`
  - `monitoring/pulse`

### Database Topology
- Universal DB: metadata and global identity (`organizations`, `global_users`, `subscriptions`, `payments`, etc.)
- Per-org tenant DB: project and delivery data (`projects`, `sprints`, `tasks`, `assignment_log`, monitoring tables, integrations, notifications)
- App-local schema (`database/init.sql`) also defines an `app` schema used by Next.js initialization scripts

## API Surface (Audit Summary)

### Next.js BFF routes
- 170+ route handlers under `app/api/**/route.ts`
- Pattern: cookie auth check -> `proxyToApiGateway()` -> upstream `/api/v1/*`
- Domain groups include: auth, tasks, sprints, assignment, monitoring, org, billing, integrations, goals, teams, agents, metrics

### API Gateway routes
Mounted in `backend/api-gateway/src/app.js`:
- `/api/v1/auth`
- `/api/v1/org`
- `/api/v1/developers`
- `/api/v1/projects`
- `/api/v1/sprints`
- `/api/v1/tasks`
- `/api/v1/assignment`
- `/api/v1/reports`
- `/api/v1/webhooks`
- `/api/v1/monitoring`
- `/api/v1/integrations`
- `/api/v1/ai`
- `/api/v1/standup`
- `/api/v1/goals`
- `/api/v1/developer-tools`
- `/api/v1/spaces`
- `/api/v1/github`
- `/api/v1/teams`
- `/api/v1/metrics`
- `/api/v1/admin/webhooks`
- `/api/v1/agents`
- `/api/v1/agent`
- `/api/v1/sprint-autopilot`

## Data Flow Diagrams

### Flow 1: Browser task create
1. Client calls `POST /api/tasks` in Next.js.
2. `app/api/tasks/route.ts` checks `auth_token` cookie.
3. BFF proxies to gateway `POST /api/v1/tasks`.
4. Gateway runs `authMiddleware` + `orgDbMiddleware`.
5. `task.controller` + services persist task in tenant DB.
6. Optional event emission / agent automation updates feeds and sockets.

### Flow 2: GitHub webhook to task
1. GitHub posts to gateway webhook endpoint.
2. Gateway verifies signature and records webhook event.
3. Inngest event is emitted (for example `github/issue.opened`).
4. `githubIssueToTask` function classifies priority/type and creates task.
5. `task/created` can trigger auto-assignment function.

### Flow 3: Agent approval lifecycle
1. Agent proposes an action and writes approval row.
2. Frontend polls `/api/agents/approvals` and listens on socket feed.
3. Reviewer approves/rejects via `/api/agent/approvals/:id/*`.
4. Gateway updates approval and action logs for traceability.

## Security Model
- Access token: JWT in `Authorization: Bearer <token>` for gateway calls.
- Browser auth: cookie-based token retrieval in Next.js BFF handlers.
- Tenant isolation: `orgDbMiddleware` resolves `req.user.orgId` to tenant pool.
- Webhooks: raw-body verification path for signature validation.
- Input shaping: environment validation via Zod in `src/config/env.js` and route-level parsing.

## Observability and Operations
- Health endpoints:
  - Next.js: app runtime health by route behavior
  - API gateway: `GET /health`
  - AI service: `GET /health`
- Logging:
  - gateway uses Morgan + custom logger middleware
  - Inngest run logs via function step output
- Queues:
  - BullMQ workers for monitoring, Jira sync, webhook retry, PR metrics

## Technology Decisions

### Next.js as BFF + UI
Why: keeps browser auth and API composition close to the UI and reduces CORS/auth complexity for frontend developers.
Trade-off: duplicated route inventory (Next.js BFF + gateway) requires discipline in docs and testing.

### API Gateway for domain logic
Why: central place for org-aware authorization, database access, webhooks, and queue workers.
Trade-off: additional hop from frontend and more deployment moving parts.

### Multi-tenant Postgres with universal + org DB
Why: strong tenant data isolation and safer enterprise scaling model.
Trade-off: provisioning/migration complexity compared to single-database row-level tenancy.

### Inngest for orchestration
Why: durable event processing with retries and step-level observability.
Trade-off: event contracts and idempotency handling become explicit engineering responsibilities.

### FastAPI ML sidecar
Why: Python ecosystem support for ML/feature pipelines while keeping gateway in Node.js.
Trade-off: cross-service operational complexity and versioning coordination.
