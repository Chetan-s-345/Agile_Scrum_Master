# System Architecture Overview

## Design Philosophy
This platform is designed as a multi-tenant, event-driven Agile operations system where product actions, engineering signals, and AI automation are first-class citizens. Instead of treating AI as a side feature, the architecture uses explicit agent workflows for planning, assignment, and monitoring, then records those actions into operational tables for traceability.

The architecture separates concerns into three runtimes: Next.js as UX and API facade, an Express API Gateway for business/domain orchestration, and a FastAPI AI Service for ML and LLM-heavy workflows. This split keeps product APIs stable while allowing AI/ML iteration cadence to evolve independently.

Event-driven behavior is implemented with Inngest plus queue workers and periodic monitors. Inngest handles durable, replayable event workflows (for example GitHub issue to task and auto-assignment), while BullMQ workers and internal monitor agents handle operational loops that are better modeled as continuously running services.

Tenant isolation is a core system decision. The universal database stores platform-level entities (organizations, plans, auth, billing), while each organization resolves to its own tenant database connection for project/sprint/task operations. This reduces cross-tenant blast radius and enables per-tenant lifecycle controls.

## High-Level Architecture

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                                USERS                                       │
│                Scrum Masters · Developers · Admins                         │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ HTTPS
┌───────────────────────────────▼────────────────────────────────────────────┐
│                            NEXT.JS APP                                    │
│  App Router Pages · UI Components · Zustand Stores · Route Handlers       │
│  Auth cookie/session boundary and API facade (/app/api/*)                 │
└───────────────────────────────┬────────────────────────────────────────────┘
                                │ Proxy REST/SSE
┌───────────────────────────────▼────────────────────────────────────────────┐
│                         API GATEWAY (Express)                             │
│ Routes · Auth/RBAC · Tenant DB routing · Webhooks · Realtime (Socket.IO) │
│ Workers (BullMQ) · Monitor Agents · Inngest event dispatch                │
└───────────────┬───────────────────────────────┬────────────────────────────┘
                │                               │
                │                               │
      ┌─────────▼──────────┐          ┌─────────▼──────────┐
      │   PostgreSQL       │          │   Redis / BullMQ   │
      │ Universal + Tenant │          │ queues + scheduling │
      │ + pgvector         │          │ + worker transport  │
      └─────────┬──────────┘          └─────────┬──────────┘
                │                               │
                │                               │
      ┌─────────▼──────────┐          ┌─────────▼──────────┐
      │ Inngest Workflows  │          │ FastAPI AI Service │
      │ Task Factory,      │          │ Sprint planning,   │
      │ Assignment,        │          │ autonomous APIs,   │
      │ Monitoring cron    │          │ ML train/predict   │
      └─────────┬──────────┘          └─────────┬──────────┘
                │                               │
     ┌──────────▼─────────┐   ┌────────────────▼─────────────────┐
     │ GitHub / Jira APIs │   │ Groq / OpenAI / Anthropic / Brevo│
     │ Webhooks + data    │   │ LLM, embeddings, email delivery   │
     └────────────────────┘   └────────────────────────────────────┘
```

## Component Responsibilities
The Next.js application owns user experience, dashboard pages, route-level protection via auth cookies, and API facade endpoints that proxy to gateway APIs. It also hosts the Inngest endpoint at `/api/inngest` and emits selected events such as `sprint/created`.

The API Gateway is the operational core. It terminates authenticated API requests, applies role and tenant context, exposes domain routes (tasks, sprints, projects, assignment, monitoring, integrations, agents), validates webhook signatures, writes/reads tenant data, emits project-scoped Socket.IO events, and dispatches Inngest events.

The AI Service is a dedicated Python runtime for AI-heavy workflows: sprint planning graph orchestration, autonomous brief/rebalance endpoints, Groq streaming features, and ML train/predict endpoints with DB persistence hooks.

The data layer combines a universal Postgres database for platform entities and per-org tenant Postgres databases for workload entities. pgvector-backed `embeddings` enable similarity search and RAG context retrieval.

Inngest functions automate event-driven pathways: GitHub issue/PR/push ingestion to task creation, duplicate checks via similarity, auto-assignment, PR merged auto-close, periodic monitoring, and sprint cleanup jobs.

Redis/BullMQ powers background workers and repeatable jobs in the gateway for asynchronous processing (webhook processing, Jira sync retries, PR metrics, monitoring jobs).

## Key Architectural Decisions

### Event-Driven Agent System
Decision: Use Inngest functions and explicit events for core automation (`github/issue.opened`, `task/created`, `github/pr.merged`, cron jobs).
Reason: Durable retries, replayability, step-level observability, and deterministic side effects for automation workflows.
Trade-off: Event contracts and operational complexity are higher than synchronous route-only logic.

### Dual Automation Runtime
Decision: Combine Inngest workflows with in-process gateway monitor agents and BullMQ workers.
Reason: Some jobs are best as durable event workflows, while others are practical as recurring operational loops tightly coupled to gateway state.
Trade-off: Two scheduling/execution planes require strong observability and runbook discipline.

### Multi-Tenant Per-Org Databases
Decision: Keep universal platform data separate from org workload data and resolve per-org DB at request time.
Reason: Better isolation, clearer blast radius, and support for tenant-specific provisioning strategies.
Trade-off: Higher operational complexity (pool management, schema consistency across tenants).

### pgvector in PostgreSQL
Decision: Use Postgres vector extension and `embeddings` table rather than an external vector service for current RAG operations.
Reason: Single storage plane, fewer moving parts, easier transactional coupling to domain records.
Trade-off: Scaling and ANN tuning are constrained by primary DB architecture compared to specialized vector stores.

### JWT + httpOnly Cookie Frontend Session
Decision: Store access token in `auth_token` httpOnly cookie in Next.js and pass bearer token to gateway.
Reason: Reduces token exposure to browser JS and centralizes auth handoff through server route handlers.
Trade-off: Additional proxy path complexity and cookie/session coupling between frontend and gateway.

### Gateway as BFF/Policy Boundary
Decision: Keep domain logic in gateway while Next.js route handlers act as facade/proxy.
Reason: UI routes remain thin while policy enforcement and integration logic stay centralized.
Trade-off: Two API layers introduce extra latency and debugging hops.

### Polyglot AI Service
Decision: Isolate AI/ML in FastAPI while keeping product API in Node/Express.
Reason: Python ecosystem fit for ML and agent tooling, Node fit for product/API/realtime stack.
Trade-off: Cross-service schema contracts and deployment orchestration become mandatory.

### Soft-Fail Integration Strategy
Decision: For non-critical integration paths (event dispatch, email, queue enqueue), prefer best-effort behavior and avoid failing primary user transaction when possible.
Reason: Better user-perceived reliability and lower blast radius from external dependency instability.
Trade-off: Requires strong delayed-failure visibility (logs, action tables, run dashboards).