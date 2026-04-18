# Deployment Guide

## Production Architecture

```text
Users
  -> CDN/Edge
    -> Next.js Web App (UI + /app/api facade)
      -> API Gateway (Express, Socket.IO, workers)
        -> Universal PostgreSQL (orgs/auth/billing)
        -> Tenant PostgreSQL per organization (projects/sprints/tasks/agents)
        -> Redis/BullMQ (queues, repeat jobs, workers)
        -> Inngest Event API (event dispatch)
        -> External APIs (GitHub, Jira, Brevo, Stripe, Groq/OpenAI/Anthropic)
      -> AI Service (FastAPI: planning/autonomous/ml)
```

Current repository deployment baseline is Render with:
- `asm-api-gateway` (Node web service)
- `asm-ai-service` (Python web service)
- `asm-redis` (Redis)

## Environment Setup

### Database

Use a universal Postgres database and per-org tenant databases.

1. Provision universal DB.
2. Apply gateway universal schema:
- `backend/api-gateway/init.sql`
3. For each tenant org DB, apply tenant schema initialization required by gateway middleware and tenant domain logic.
4. Optional app schema bootstrap for Next app-local tables:
- `npm run init:app-db` (root script)

pgvector enablement:
- Gateway embeddings service uses `CREATE EXTENSION IF NOT EXISTS vector` and `embeddings` table initialization.
- Ensure DB role has extension permissions.

Backup strategy:
- Daily logical backups for universal DB.
- Daily logical backups for each tenant DB.
- Weekly full snapshot retention.

Suggested commands:
```bash
pg_dump "$UNIVERSAL_DATABASE_URL" > universal_$(date +%F).sql
pg_dump "$TENANT_DATABASE_URL" > tenant_$(date +%F).sql
```

## Backend Deployment

Recommended platform: Render (already encoded in `render.yaml`).

### API Gateway
Service:
- rootDir: `backend/api-gateway`
- build: `npm ci`
- start: `npm start`
- health: `GET /health`

Required env:
- `UNIVERSAL_DATABASE_URL`
- `JWT_SECRET`, `REFRESH_TOKEN_SECRET`
- `REDIS_URL`
- `AI_SERVICE_URL`
- `FRONTEND_URL`
- Optional integrations: Groq/OpenAI/Anthropic/Brevo/GitHub/Jira/Stripe

### AI Service
Service:
- rootDir: `backend/ai-service`
- build: `pip install -r requirements.txt`
- start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- health: `GET /health`

Required env:
- `DATABASE_URL` (if ML persistence is needed)
- `GROQ_API_KEY` (for Groq streaming features)
- Optional model/env overrides

## Frontend Deployment

Recommended options:
- Vercel (preferred for Next.js)
- Render web service (also possible)

Build/start:
- build: `next build`
- start: `next start`

Required env:
- `API_GATEWAY_URL`
- `AI_SERVICE_URL` (if direct warmups or service checks are required)
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- Non-secret client vars only via `NEXT_PUBLIC_*`

Routing:
- App Router handles internal routing.
- Ensure reverse proxy forwards cookie headers and websocket upgrades if Socket.IO is used from the browser.

## Inngest Production Setup

1. Set event/signing keys in deployment env:
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`

2. Register endpoint:
- Next.js endpoint: `/api/inngest`

3. Ensure gateway event dispatch resolves target endpoint.
- In non-local environments, set Inngest endpoint/key so `sendInngestEvent` posts to cloud endpoint.

4. Verify registration:
- Confirm function list appears for:
  - `sprint-created-groq-brief`
  - task-factory workflows (`github-issue-to-task`, `pr-to-task`, `project-monitoring-pulse`, etc.)

## GitHub Webhook Setup

1. In GitHub repo webhook settings:
- Payload URL: `<gateway-base>/api/v1/webhooks/github?orgId=<org-uuid>`
- Content type: `application/json`
- Secret: match `GITHUB_WEBHOOK_SECRET`

2. Subscribe to events:
- Issues
- Pull requests
- Push

3. Validate delivery:
- Check gateway response 200.
- Verify row in `webhook_events`.
- Verify Inngest events fire for supported mappings.

## Monitoring in Production

Monitor these signals:

- API Gateway health: `GET /health`
- AI service health: `GET /health`
- Redis availability and queue depth
- Inngest function failure/retry rates
- `agent_runs` freshness and status
- `agent_actions` failure counts
- Webhook DLQ growth (`admin/webhooks/dlq`)
- API latency and p95 by route group

Logging strategy:
- Structured logger in gateway middleware.
- Keep request logs + agent action logs + worker errors.
- Correlate by orgId/projectId where possible.

## Disaster Recovery

### Database backup and restore
Backup:
```bash
pg_dump "$UNIVERSAL_DATABASE_URL" > universal_backup.sql
pg_dump "$TENANT_DATABASE_URL" > tenant_backup.sql
```

Restore:
```bash
psql "$UNIVERSAL_DATABASE_URL" < universal_backup.sql
psql "$TENANT_DATABASE_URL" < tenant_backup.sql
```

### If Inngest is unavailable
- Core API should continue serving CRUD operations.
- Automation features will degrade.
- Temporarily run manual assignment/monitoring via gateway APIs and monitor queues.
- Replay deferred events once Inngest recovers.

### If GitHub webhook delivery stops
- Validate secret mismatch and payload URL.
- Use GitHub redelivery.
- Use ingestion resync endpoints (`/api/v1/github/ingest` and resync variants) to backfill context and embeddings.

### If agent automation stops running
- Check worker and scheduler toggles (`ENABLE_SCHEDULER`, `ENABLE_WORKERS`).
- Validate Redis connectivity.
- Inspect `agent_runs` and queue worker logs.
- Restart API gateway workers and ensure monitors are reinitialized.

## Operational Checklist

- Verify all secrets are present in deploy platform.
- Validate org DB provisioning path (`manual` or `neon`).
- Run schema checks before traffic cutover.
- Smoke test auth, project creation, sprint creation, task assignment, webhook ingestion, and agent approval flows.
- Confirm observability dashboards before enabling autonomous modes.