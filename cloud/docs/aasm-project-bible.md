# Automated Agentic Scrum Master (AASM) - Internal Project Bible

Version: 1.0  
Audience: Product engineers, platform engineers, AI engineers, SRE/DevOps, security, QA, technical writers  
Scope: Full system architecture, implementation contracts, operations, and extension guidance

---

## 1. Executive Summary

Automated Agentic Scrum Master (AASM) is an enterprise multi-tenant SaaS platform that automates the operational workload of Scrum teams by combining project management workflows with event-driven AI agents. In plain English, AASM watches engineering activity (especially in GitHub), understands context, creates and updates work items, intelligently assigns tasks to the best-fit developers, and continuously monitors sprint health for blockers, SLA risks, and delivery drift.

### What problem AASM solves

Traditional sprint operations are still largely manual and reactive:

1. Scrum masters and tech leads manually convert code and issue activity into backlog updates.
2. Teams discover blockers late because monitoring is human-driven and periodic.
3. Assignment quality varies, often leading to uneven workload and burnout.
4. Duplicate task creation and context loss happen across tools.
5. Sprint health metrics are often retrospective, not actionable in real-time.

AASM solves these by making task lifecycle automation continuous, contextual, and explainable.

### How AI agents automate the Scrum lifecycle

AASM runs three coordinated agents:

1. Task Generation Agent: Converts GitHub and project signals into structured work items while preventing duplicates through RAG similarity checks.
2. Auto Assignment Agent: Selects assignees using skill match, current load, and performance scoring.
3. Monitoring Agent: Detects inactivity, blockers, SLA breaches, and sprint trajectory risk, then emits alerts and can auto-reassign.

These agents are orchestrated by Inngest events and backed by Redis, PostgreSQL, Pinecone, OpenAI/Anthropic APIs, and GitHub APIs.

### Competitive comparison (10+ differentiators)

| Feature                      | AASM            | Jira             | Linear  | Asana    | ClickUp  |
| ---------------------------- | --------------- | ---------------- | ------- | -------- | -------- |
| Auto task creation from code | Native          | Limited          | Limited | Limited  | Limited  |
| Skill-aware auto assignment  | Native          | Plugin rules     | Basic   | Basic    | Basic    |
| Live blocker detection       | Native          | Mostly manual    | Partial | Partial  | Partial  |
| RAG context awareness        | Native          | Add-ons          | No      | No       | No       |
| Duplicate task prevention    | Threshold guard | Manual           | Manual  | Manual   | Manual   |
| Event-driven agent runtime   | Inngest native  | No native        | No      | No       | No       |
| GitHub workflow depth        | Deep native     | Good             | Good    | Moderate | Moderate |
| SLA auto-reassignment        | Native          | Custom rules     | Limited | Limited  | Limited  |
| Per-project agent config     | Native          | Workflow config  | Limited | Limited  | Limited  |
| Agent observability logs     | Native          | Plugin based     | Limited | Limited  | Limited  |
| Redis workload balancing     | Native          | Query based      | No      | No       | No       |
| Event-to-task traceability   | Native          | Partial          | Partial | Partial  | Partial  |
| Agent ROI metrics            | Native          | Custom dashboard | Limited | Limited  | Limited  |

---

## 2. System Architecture

### Layered architecture diagram (Mermaid)

```mermaid
flowchart TD
  U[User Browser] -->|UI Events| C[Next.js 14 App Router UI]
  C -->|REST JSON| A[API Routes /api/*]
  A -->|Session Check| AUTH[NextAuth + JWT]
  AUTH -->|OAuth Token| GHAUTH[GitHub OAuth]
  A -->|SQL Query| DB[(PostgreSQL)]
  A -->|Cache Read/Write| R[(Redis)]
  A -->|Event Publish| INGW[Inngest Ingress /api/inngest]
  A -->|Embedding/LLM Call| LLM[groq APIs]
  A -->|Vector Query| PC[(Pinecone Vector DB)]
  A -->|Webhook/API I/O| GH[GitHub API + Webhooks]

  GH -->|Webhook Payload| WH[/api/github/webhook]
  WH -->|Event Store| DB
  WH -->|Inngest Event| INGW

  INGW -->|github.*| TG[Task Generation Agent]
  INGW -->|task.created| AA[Auto Assignment Agent]
  INGW -->|task.updated + cron| MA[Monitoring Agent]

  TG -->|Insert Task| DB
  TG -->|Similarity Query| PC
  TG -->|Prompt + Parse| LLM
  TG -->|Rate Limit Check| R
  TG -->|Emit task.created| INGW

  AA -->|Update Assignee| DB
  AA -->|Load Counter| R
  AA -->|Emit task.assigned| INGW

  MA -->|Insert Alerts| DB
  MA -->|Dedup + Cache| R
  MA -->|Issue/PR Updates| GH
  MA -->|Emit alert.triggered| INGW

  DB -->|Read Models| C
  R -->|Cached Metrics| C
```

### End-to-end data flow narrative (GitHub push to task lifecycle)

1. Developer pushes commits to connected repository.
2. GitHub sends `push` webhook to `/api/github/webhook`.
3. API verifies `X-Hub-Signature-256` with `GITHUB_WEBHOOK_SECRET`.
4. Payload is persisted in `GitHubEvent` (idempotent by delivery id).
5. API emits Inngest event `github.push`.
6. Task Generation Agent consumes event, extracts branch/commit context.
7. Agent queries Pinecone for similar task vectors (top-k=5).
8. If high duplication score, skip creation and log outcome.
9. If not duplicate, agent calls LLM for structured task proposal.
10. Task is inserted into PostgreSQL and vector is upserted to Pinecone.
11. Agent emits `task.created` event.
12. Auto Assignment Agent receives `task.created`, scores team members.
13. Best candidate is assigned; `TaskAssignment` is recorded.
14. Agent emits `task.assigned`; Redis load counters are updated.
15. Monitoring Agent (scheduled and event-driven) tracks task progression.
16. If risk detected, it creates `Alert`, emits `alert.triggered`, and may comment on GitHub issue/PR.
17. UI dashboards read aggregated status from PostgreSQL + Redis caches.

### Multi-tenant architecture

AASM enforces tenant boundaries at workspace level:

1. Core partition key: `workspaceId` on all tenant-owned entities.
2. Query policy: all read/write operations include workspace scope.
3. Vector isolation: Pinecone namespace per `projectId` (implicitly workspace-scoped).
4. Redis key scoping: keys include workspace/project identifiers.
5. Access control: membership and role checks through `WorkspaceMember`.

### Authentication flow (NextAuth + JWT + session)

1. User signs in via GitHub OAuth or credentials.
2. NextAuth callback resolves identity and links user account.
3. Session/JWT includes user id, workspace role bindings, and token metadata.
4. API route middleware validates session and authorizes by role.
5. Session objects can be cached in Redis for performance and revocation workflows.

### RAG pipeline lifecycle

1. Ingestion: task/document/issue/commit text is normalized and chunked.
2. Embedding: OpenAI `text-embedding-3-small` produces 1536-d vectors.
3. Storage: vectors are upserted into Pinecone with metadata.
4. Query: new task generation embeds incoming context and performs top-k search.
5. Prompting: retrieved matches are injected as “existing similar tasks”.
6. Decisioning: model output must include confidence and duplicate rationale.
7. Persistence: outputs and vector link references are stored in DB.

---

## 3. Environment Variables

| Variable                   | Service      | Purpose                 | Source                | Required | Example                   |
| -------------------------- | ------------ | ----------------------- | --------------------- | -------- | ------------------------- |
| `DATABASE_URL`             | PostgreSQL   | Prisma DB connection    | Neon/Supabase/Railway | Yes      | `postgresql://...`        |
| `REDIS_URL`                | Redis        | Native Redis URL        | Upstash/Redis Cloud   | Optional | `rediss://...`            |
| `NEXTAUTH_SECRET`          | NextAuth     | Session signing key     | Generated secret      | Yes      | `base64_secret`           |
| `NEXTAUTH_URL`             | NextAuth     | Auth callback base URL  | Deploy URL            | Yes      | `https://app.domain`      |
| `GITHUB_CLIENT_ID`         | GitHub OAuth | OAuth app client id     | GitHub OAuth app      | Yes      | `Iv1.xxxxx`               |
| `GITHUB_CLIENT_SECRET`     | GitHub OAuth | OAuth app client secret | GitHub OAuth app      | Yes      | `gho_xxxxx`               |
| `GITHUB_WEBHOOK_SECRET`    | GitHub App   | Webhook HMAC secret     | GitHub App webhook    | Yes      | `whsec_xxxxx`             |
| `GITHUB_APP_ID`            | GitHub App   | GitHub App id           | GitHub App settings   | Yes      | `123456`                  |
| `GITHUB_APP_PRIVATE_KEY`   | GitHub App   | App PEM private key     | GitHub App keys       | Yes      | `-----BEGIN...`           |
| `OPENAI_API_KEY`           | OpenAI       | LLM and embedding auth  | OpenAI console        | Yes\*    | `sk-proj-...`             |
| `ANTHROPIC_API_KEY`        | Anthropic    | Alt LLM auth            | Anthropic console     | Optional | `sk-ant-...`              |
| `PINECONE_API_KEY`         | Pinecone     | Vector API auth         | Pinecone console      | Yes      | `pcsk_...`                |
| `PINECONE_ENVIRONMENT`     | Pinecone     | Index environment       | Pinecone index        | Yes      | `us-east-1-aws`           |
| `PINECONE_INDEX_NAME`      | Pinecone     | Index name              | Pinecone index        | Yes      | `aasm-main-index`         |
| `INNGEST_EVENT_KEY`        | Inngest      | Event ingest key        | Inngest app           | Yes      | `evt_...`                 |
| `INNGEST_SIGNING_KEY`      | Inngest      | Callback signing key    | Inngest app           | Yes      | `signkey_...`             |
| `INNGEST_BASE_URL`         | Inngest      | Inngest base URL        | Inngest env           | Yes      | `https://api.inngest.com` |
| `UPSTASH_REDIS_REST_URL`   | Upstash      | Redis REST URL          | Upstash database      | Optional | `https://xxx.upstash.io`  |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash      | Redis REST token        | Upstash database      | Optional | `token_value`             |
| `NEXT_PUBLIC_APP_URL`      | Frontend     | Public app URL          | Deploy env            | Yes      | `https://app.domain`      |
| `NEXT_PUBLIC_WS_URL`       | Frontend     | WS/SSE URL              | Realtime endpoint     | Optional | `wss://app.domain/ws`     |

Notes:

1. Prefer server-only variables in secure project settings, never in client bundles.
2. Validate required variables at boot and fail fast with clear diagnostics.
3. Rotate GitHub and LLM keys on a fixed security cadence.

---

## 4. Database Schema (PostgreSQL via Prisma)

### Canonical Prisma model sketch

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  avatar    String?
  role      String   @default("MEMBER")
  createdAt DateTime @default(now())

  workspaceMembers WorkspaceMember[]
  ownedWorkspaces  Workspace[]        @relation("WorkspaceOwner")
  taskAssignments  TaskAssignment[]
  teamProfiles     TeamMember[]
}

model Workspace {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  plan      String   @default("FREE")
  ownerId   String
  settings  Json
  createdAt DateTime @default(now())

  owner       User              @relation("WorkspaceOwner", fields: [ownerId], references: [id])
  members     WorkspaceMember[]
  projects    Project[]
  teamMembers TeamMember[]

  @@index([ownerId])
}

model WorkspaceMember {
  userId      String
  workspaceId String
  role        String
  createdAt   DateTime @default(now())

  user      User      @relation(fields: [userId], references: [id])
  workspace Workspace @relation(fields: [workspaceId], references: [id])

  @@id([userId, workspaceId])
  @@index([workspaceId, role])
}

model Project {
  id                   String   @id @default(cuid())
  name                 String
  workspaceId          String
  githubRepoUrl        String?
  githubInstallationId String?
  agentConfig          Json
  createdAt            DateTime @default(now())

  workspace       Workspace        @relation(fields: [workspaceId], references: [id])
  sprints         Sprint[]
  tasks           Task[]
  agentRuns       AgentRun[]
  githubEvents    GitHubEvent[]
  alerts          Alert[]
  vectorDocuments VectorDocument[]

  @@index([workspaceId])
}

model Sprint {
  id        String   @id @default(cuid())
  projectId String
  name      String
  goal      String?
  startDate DateTime
  endDate   DateTime
  status    String
  createdAt DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id])
  tasks   Task[]

  @@index([projectId, status])
}

model Task {
  id             String   @id @default(cuid())
  sprintId       String?
  projectId      String
  title          String
  description    String
  type           String
  status         String
  priority       String
  effortPoints   Int?
  assigneeId     String?
  createdByAgent Boolean  @default(false)
  ragContextIds  String[]
  githubIssueUrl String?
  githubPrUrl    String?
  blockerReason  String?
  dueDate        DateTime?
  completedAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  sprint      Sprint?          @relation(fields: [sprintId], references: [id])
  project     Project          @relation(fields: [projectId], references: [id])
  assignments TaskAssignment[]
  alerts      Alert[]

  @@index([projectId, status, priority])
  @@index([assigneeId])
}

model TaskAssignment {
  taskId           String
  userId           String
  assignedByAgent  Boolean  @default(false)
  matchScore       Float
  assignedAt       DateTime @default(now())

  task Task @relation(fields: [taskId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@id([taskId, userId, assignedAt])
  @@index([userId, assignedAt])
}

model TeamMember {
  id               String   @id @default(cuid())
  workspaceId      String
  userId           String
  skills           String[]
  currentLoad      Int      @default(0)
  performanceScore Float    @default(0.5)
  availableFrom    DateTime?

  workspace Workspace @relation(fields: [workspaceId], references: [id])
  user      User      @relation(fields: [userId], references: [id])

  @@unique([workspaceId, userId])
  @@index([workspaceId])
}

model AgentRun {
  id          String   @id @default(cuid())
  agentType   String
  status      String
  projectId   String
  inngestRunId String?
  triggeredBy String?
  input       Json
  output      Json?
  duration    Int?
  createdAt   DateTime @default(now())

  project Project   @relation(fields: [projectId], references: [id])
  logs    AgentLog[]

  @@index([projectId, createdAt])
}

model AgentLog {
  id         String   @id @default(cuid())
  agentRunId String
  level      String
  message    String
  metadata   Json?
  createdAt  DateTime @default(now())

  agentRun AgentRun @relation(fields: [agentRunId], references: [id])

  @@index([agentRunId, level])
}

model GitHubEvent {
  id          String   @id @default(cuid())
  projectId   String
  type        String
  payload     Json
  processed   Boolean  @default(false)
  taskCreated Boolean  @default(false)
  deliveryId  String   @unique
  createdAt   DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId, type, createdAt])
}

model Alert {
  id        String   @id @default(cuid())
  projectId String
  taskId    String?
  type      String
  severity  String
  message   String
  resolved  Boolean  @default(false)
  resolvedAt DateTime?
  createdAt DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id])
  task    Task?   @relation(fields: [taskId], references: [id])

  @@index([projectId, resolved, severity])
}

model VectorDocument {
  id         String   @id @default(cuid())
  projectId  String
  type       String
  externalId String?
  content    String
  pineconeId String   @unique
  embeddedAt DateTime?
  createdAt  DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id])

  @@index([projectId, type])
}
```

### Model-by-model feature usage matrix

| Model           | Core purpose                                | Feature modules using it                     |
| --------------- | ------------------------------------------- | -------------------------------------------- |
| User            | Identity and profile                        | Auth, Team page, Assignments                 |
| Workspace       | Tenant boundary and billing plan            | Workspace settings, member management        |
| WorkspaceMember | Role-based access                           | API authorization and UI gating              |
| Project         | Repo binding + agent configuration          | Agents page, GitHub integration, board scope |
| Sprint          | Time-boxed planning unit                    | Board/backlog views, analytics               |
| Task            | Central work item                           | Backlog, board, monitoring, analytics        |
| TaskAssignment  | Assignment history and scoring traceability | Team load, assignment audit                  |
| TeamMember      | Skills/load/performance profile             | Auto Assignment Agent                        |
| AgentRun        | Function-level execution tracking           | Admin dashboards, troubleshooting            |
| AgentLog        | Fine-grained execution logs                 | Agents live logs panel                       |
| GitHubEvent     | Raw webhook traceability                    | GitHub page, task generation pipeline        |
| Alert           | Risk and incident signaling                 | Monitoring page, dashboard banner            |
| VectorDocument  | RAG storage bridge                          | Task generation dedup and context retrieval  |

---

## 5. Every Page - Full Details

### Auth Pages

#### Route: `/login`

1. Purpose: Authenticate user via GitHub OAuth or email/password.
2. Components:
   - `LoginPage`
   - `OAuthProviderButtons`
   - `CredentialSignInForm`
   - `AuthErrorBanner`
3. API calls:
   - `POST /api/auth/[...nextauth]` (credentials and OAuth callbacks)
4. Data fetching:
   - Server-side: CSRF token/session check
   - Client-side: form submission and auth provider redirects
5. Key state:
   - `email`, `password`, `isSubmitting`, `authError`
6. Interactions:
   - Submit credentials -> sign-in attempt
   - Click GitHub -> OAuth redirect
7. Realtime:
   - None

#### Route: `/register`

1. Purpose: Post-auth workspace bootstrap and initial project setup.
2. Components:
   - `WorkspaceCreateForm`
   - `PlanSelector`
   - `ProjectQuickStartForm`
3. API calls:
   - `POST /api/workspaces`
   - `POST /api/projects`
4. Data fetching:
   - Server-side: current user session
   - Client-side: form submission, slug availability checks
5. Key state:
   - `workspaceName`, `workspaceSlug`, `plan`, `projectName`
6. Interactions:
   - Create workspace -> auto-member role OWNER
   - Optional project create -> redirect to dashboard
7. Realtime:
   - None

### Dashboard

#### Route: `/dashboard`

1. Purpose: Portfolio-level overview of workspace health.
2. Components:
   - `WorkspaceOverviewHeader`
   - `SprintHealthCards`
   - `RecentAgentActivity`
   - `AlertsBanner`
3. API calls:
   - `GET /api/workspaces`
   - `GET /api/alerts/[projectId]`
   - `GET /api/projects/[id]/agents/status`
4. Data fetching:
   - Server-side for initial workspace/project summaries
   - Client polling for agent status and alert counts (60s)
5. Key state:
   - `selectedWorkspace`, `projects`, `healthMetrics`, `alerts`
6. Interactions:
   - Workspace switch -> refetch scoped summaries
   - Alert click -> navigate to monitor page
7. Realtime:
   - Polling for alerts and agent status

### Sprint Board

#### Route: `/[workspace]/[project]/board`

1. Purpose: Kanban execution board for active sprint.
2. Components:
   - `BoardToolbar`
   - `KanbanColumn` x5 (`TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `BLOCKED`)
   - `TaskCard`
   - `TaskDetailDrawer`
3. API calls:
   - `GET /api/sprints/[id]/tasks`
   - `PATCH /api/tasks/[id]`
4. Data fetching:
   - Server-side initial sprint + tasks
   - Client polling every 30s for task deltas
5. Key state:
   - `columns`, `dragState`, `selectedTaskId`, `isSaving`
6. Interactions:
   - Drag-and-drop updates task status
   - Open task drawer for details/edit
   - Blocked flag edit updates alert logic
7. Realtime:
   - Polling 30s for board updates and conflict reconciliation

### Backlog

#### Route: `/[workspace]/[project]/backlog`

1. Purpose: Full task inventory and planning operations.
2. Components:
   - `BacklogTable`
   - `TaskFiltersPanel`
   - `BulkActionsBar`
   - `CreateTaskModal`
3. API calls:
   - `GET /api/projects/[id]/sprints`
   - `POST /api/tasks`
   - `PATCH /api/tasks/[id]`
   - `DELETE /api/tasks/[id]`
4. Data fetching:
   - Server-side baseline list and sprint metadata
   - Client-side filter and pagination controls
5. Key state:
   - `filters`, `selectedTaskIds`, `activeSprintId`, `modalOpen`
6. Interactions:
   - Bulk assign sprint
   - Bulk priority update
   - Create manual tasks
7. Realtime:
   - Optional polling 60s in large boards

### Agentic Scrum Master Page

#### Route: `/[workspace]/[project]/agents`

1. Purpose: Control plane for all AI agents.
2. Components:
   - `AgentCard` (Task Gen, Auto Assign, Monitor)
   - `LogPanel`
   - `LiveFeed`
   - `InngestPipeline`
   - `TeamLoadGrid`
   - `AgentSettingsToggles`
3. API calls:
   - `GET /api/projects/[id]/agents/status`
   - `POST /api/agents/task-gen/trigger`
   - `POST /api/agents/auto-assign/trigger`
   - `POST /api/agents/monitor/trigger`
   - `GET /api/agents/[id]/logs`
   - `GET /api/team/[projectId]`
4. Data fetching:
   - Server-side: project config + last runs
   - Client-side: log stream polling every 10s or SSE
5. Key state:
   - `agentStatuses`, `selectedAgent`, `runInProgress`, `logLevelFilter`, `teamLoad`
6. Interactions:
   - Trigger agent manually
   - Toggle autonomous mode per agent
   - Inspect pipeline step statuses
7. Realtime:
   - Live run status, logs, and feed updates

Sub-component details:

1. `AgentCard`: health state, last run duration, run count, trigger controls.
2. `LogPanel`: paginated logs, level filtering, JSON metadata drill-down.
3. `LiveFeed`: event timeline (`github.push` -> `task.created` -> `task.assigned` -> alerts).
4. `InngestPipeline`: visual event/function dependency map and backlog depth.
5. `TeamLoadGrid`: per member load %, active tasks, overload highlights.

### GitHub Integration

#### Route: `/[workspace]/[project]/github`

1. Purpose: repository connection and webhook observability.
2. Components:
   - `ConnectedRepoCard`
   - `WebhookStatusBadge`
   - `RecentEventsTable`
   - `EventTaskMappingPanel`
3. API calls:
   - `GET /api/github/events/[projectId]`
   - `POST /api/github/webhook` (ingress endpoint, not called by UI)
4. Data fetching:
   - Server-side recent webhook processing data
5. Key state:
   - `repoConnectionState`, `events`, `selectedEvent`
6. Interactions:
   - Refresh events
   - View event payload and resulting tasks
7. Realtime:
   - Poll events every 30s

### Monitoring

#### Route: `/[workspace]/[project]/monitor`

1. Purpose: risk intelligence console.
2. Components:
   - `ActiveAlertsList`
   - `BlockerDetailPanel`
   - `SLABreachTracker`
   - `InactivityHeatmap`
   - `AutoReassignmentHistory`
3. API calls:
   - `GET /api/alerts/[projectId]`
   - `PATCH /api/alerts/[id]/resolve`
4. Data fetching:
   - Server-side initial alert set
   - Client polling every 15s for critical updates
5. Key state:
   - `alerts`, `severityFilter`, `resolvedView`, `selectedAlert`
6. Interactions:
   - Resolve alert
   - Jump to linked task
7. Realtime:
   - Fast polling for critical alert lane

### Team

#### Route: `/[workspace]/[project]/team`

1. Purpose: workforce capability and allocation view.
2. Components:
   - `DeveloperProfileCard`
   - `WorkloadBars`
   - `SkillTagsEditor`
   - `AssignmentHistoryTable`
   - `PerformanceScoreWidget`
3. API calls:
   - `GET /api/team/[projectId]`
   - `PATCH /api/team/[memberId]/skills`
4. Data fetching:
   - Server-side team roster and metrics
5. Key state:
   - `teamMembers`, `editedSkills`, `saveState`
6. Interactions:
   - Update skills
   - Review assignment traces
7. Realtime:
   - Poll load counters every 30s

### Analytics

#### Route: `/[workspace]/[project]/analytics`

1. Purpose: delivery metrics and AI impact measurement.
2. Components:
   - `BurndownChart`
   - `VelocityChart`
   - `CycleTimePanel`
   - `ThroughputPanel`
   - `AgentROIMetrics`
3. API calls:
   - `GET /api/analytics/[projectId]`
4. Data fetching:
   - Server-side aggregated metrics
5. Key state:
   - `dateRange`, `chartResolution`, `metricCards`
6. Interactions:
   - Change date range
   - Compare sprint windows
7. Realtime:
   - Optional 5-minute refresh

### Settings

#### Route: `/[workspace]/settings`

1. Purpose: tenant administration and billing.
2. Components:
   - `WorkspaceConfigForm`
   - `BillingPlanPanel`
   - `MemberManagementTable`
3. API calls:
   - `GET /api/workspaces`
   - `POST /api/workspaces` (for workspace creation flows)
4. Data fetching:
   - Server-side workspace and member details
5. Key state:
   - `workspaceSettings`, `members`, `billingPlan`

#### Route: `/[workspace]/[project]/settings`

1. Purpose: per-project automation and integration settings.
2. Components:
   - `AgentConfigEditor`
   - `GitHubConnectionPanel`
   - `RagConfigForm`
   - `InngestWebhookInfo`
   - `AutoAssignRulesEditor`
3. API calls:
   - `POST /api/projects`
   - `GET /api/projects/[id]/agents/status`
4. Data fetching:
   - Server-side project config JSON
5. Key state:
   - `agentConfig`, `ragThresholds`, `autoAssignRules`

### Admin

#### Route: `/admin`

1. Purpose: platform-wide operational oversight.
2. Components:
   - `PlatformMetricsCards`
   - `AgentHealthTable`
   - `ErrorRateTrendChart`
   - `ActiveWorkspacesList`
3. API calls:
   - Internal admin aggregate endpoints (often composed server-side)
4. Data fetching:
   - Server-side only with strict admin authorization
5. Realtime:
   - Poll every 60s

---

## 6. All API Routes - Complete Specification

Error response contract for all routes:

```ts
interface ApiError {
  error: string;
  code: number;
  detail: string;
}
```

### `POST /api/auth/[...nextauth]`

- Auth: Public entrypoint, provider-internal validation.
- Request: Provider-dependent (credentials, OAuth callback payload).
- Response:

```ts
interface AuthResponse {
  ok: boolean;
  url?: string;
}
```

- DB ops: user upsert, account/session linkage.
- Triggers: session cache updates.
- Errors: invalid credentials, provider callback mismatch.

### `GET /api/workspaces`

- Auth: Session required.
- Response:

```ts
interface WorkspaceListResponse {
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
    plan: string;
  }>;
}
```

- DB queries: select memberships + workspace metadata scoped by user id.
- Triggers: none.
- Errors: unauthorized, empty membership.

### `POST /api/workspaces`

- Auth: Session required.
- Request:

```ts
interface CreateWorkspaceRequest {
  name: string;
  slug: string;
  plan?: "FREE" | "PRO" | "ENTERPRISE";
  settings?: Record<string, unknown>;
}
```

- Response:

```ts
interface CreateWorkspaceResponse {
  workspaceId: string;
  slug: string;
}
```

- DB queries: insert workspace + owner membership.
- Triggers: optional onboarding event `workspace.created`.
- Errors: slug conflict, validation failure.

### `GET /api/workspaces/[id]/projects`

- Auth: Session + workspace membership.
- Response:

```ts
interface ProjectListResponse {
  projects: Array<{ id: string; name: string; githubRepoUrl?: string }>;
}
```

- DB: list projects by workspace id.
- Errors: not member, workspace not found.

### `POST /api/projects`

- Auth: Session + role OWNER/ADMIN.
- Request:

```ts
interface CreateProjectRequest {
  workspaceId: string;
  name: string;
  githubRepoUrl?: string;
  githubInstallationId?: string;
  agentConfig?: Record<string, unknown>;
}
```

- Response:

```ts
interface CreateProjectResponse {
  projectId: string;
}
```

- DB: insert project.
- Triggers: `project.created` optional.
- Errors: forbidden, invalid GitHub repo URL.

### `GET /api/projects/[id]/sprints`

- Auth: Session + membership.
- Response:

```ts
interface SprintListResponse {
  sprints: Array<{
    id: string;
    name: string;
    status: "PLANNING" | "ACTIVE" | "COMPLETED";
    startDate: string;
    endDate: string;
  }>;
}
```

- DB: select sprints by project id.
- Errors: unauthorized scope.

### `POST /api/sprints`

- Auth: Session + OWNER/ADMIN/SCRUM_MASTER role.
- Request:

```ts
interface CreateSprintRequest {
  projectId: string;
  name: string;
  goal?: string;
  startDate: string;
  endDate: string;
  status?: "PLANNING" | "ACTIVE" | "COMPLETED";
}
```

- Response:

```ts
interface CreateSprintResponse {
  sprintId: string;
}
```

- DB: insert sprint.
- Triggers: `sprint.started` when status `ACTIVE`.
- Errors: date window invalid.

### `GET /api/sprints/[id]/tasks`

- Auth: Session + membership.
- Response:

```ts
interface SprintTasksResponse {
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    assigneeId?: string;
    updatedAt: string;
  }>;
}
```

- DB: select tasks by sprint id.
- Errors: forbidden scope.

### `POST /api/tasks`

- Auth: Session.
- Request:

```ts
interface CreateTaskRequest {
  projectId: string;
  sprintId?: string;
  title: string;
  description: string;
  type: "STORY" | "BUG" | "TASK" | "SPIKE";
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  effortPoints?: number;
  dueDate?: string;
}
```

- Response:

```ts
interface CreateTaskResponse {
  taskId: string;
  createdByAgent: boolean;
}
```

- DB: insert task.
- Triggers: optional `task.created` when auto-assign is enabled.
- Pinecone: optional embed and upsert.
- Errors: validation, project scope mismatch.

### `PATCH /api/tasks/[id]`

- Auth: Session.
- Request:

```ts
interface PatchTaskRequest {
  status?: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "BLOCKED";
  priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  assigneeId?: string | null;
  blockerReason?: string | null;
  dueDate?: string | null;
}
```

- Response:

```ts
interface PatchTaskResponse {
  taskId: string;
  updatedAt: string;
}
```

- DB: update task row.
- Triggers: emit `task.updated`; if blocked emit `task.blocked`.
- Redis: invalidate load/alerts caches as needed.
- Errors: invalid transition, forbidden.

### `DELETE /api/tasks/[id]`

- Auth: Session + role checks.
- Response:

```ts
interface DeleteTaskResponse {
  deleted: boolean;
  taskId: string;
}
```

- DB: delete task and related assignment references (transaction).
- Triggers: invalidate dashboards.
- Errors: not found, forbidden.

### `POST /api/tasks/[id]/assign`

- Auth: Session or service token.
- Request:

```ts
interface AssignTaskRequest {
  userId?: string;
  mode?: "MANUAL" | "AUTO";
}
```

- Response:

```ts
interface AssignTaskResponse {
  taskId: string;
  assigneeId: string;
  matchScore?: number;
}
```

- DB: insert `TaskAssignment`, update `Task.assigneeId`.
- Redis: increment load key.
- Triggers: `task.assigned`.
- Errors: overloaded assignee, user not in workspace.

### `GET /api/projects/[id]/agents/status`

- Auth: Session.
- Response:

```ts
interface AgentStatusResponse {
  projectId: string;
  statuses: Array<{
    agentType: "TASK_GEN" | "AUTO_ASSIGN" | "MONITOR";
    state: "RUNNING" | "IDLE";
    lastRunAt?: string;
    lastDurationMs?: number;
  }>;
}
```

- DB: latest `AgentRun` per type.
- Redis: read `agent:status:*` for current state.
- Errors: unauthorized scope.

### `POST /api/agents/task-gen/trigger`

- Auth: Session/admin service token.
- Request:

```ts
interface TriggerTaskGenRequest {
  projectId: string;
  sourceEventId?: string;
  dryRun?: boolean;
}
```

- Response:

```ts
interface TriggerAgentResponse {
  accepted: boolean;
  runId: string;
}
```

- DB: insert `AgentRun`.
- Inngest: emit trigger event.
- Errors: agent disabled, concurrency limit reached.

### `POST /api/agents/auto-assign/trigger`

- Auth: Session/admin service token.
- Request:

```ts
interface TriggerAutoAssignRequest {
  projectId: string;
  taskId: string;
}
```

- Response: same as trigger response.
- DB: create `AgentRun`.
- Inngest: emit assign trigger.
- Errors: task not found.

### `POST /api/agents/monitor/trigger`

- Auth: Session/admin service token.
- Request:

```ts
interface TriggerMonitorRequest {
  projectId: string;
  scope?: "PROJECT" | "WORKSPACE";
}
```

- Response: trigger response.
- Inngest: emit monitor trigger.
- Errors: project inactive.

### `GET /api/agents/[id]/logs`

- Auth: Session.
- Query: `level`, `cursor`, `limit`.
- Response:

```ts
interface AgentLogsResponse {
  logs: Array<{
    id: string;
    level: "INFO" | "WARN" | "ERROR" | "SUCCESS";
    message: string;
    metadata?: Record<string, unknown>;
    createdAt: string;
  }>;
  nextCursor?: string;
}
```

- DB: read `AgentLog` by `agentRunId` with pagination.
- Errors: run not accessible.

### `POST /api/github/webhook`

- Auth: Public endpoint with HMAC verification.
- Request: Raw GitHub webhook payload.
- Response:

```ts
interface GitHubWebhookResponse {
  accepted: boolean;
  deliveryId: string;
  eventType: string;
}
```

- DB: insert GitHubEvent idempotently.
- Inngest: emit mapped event.
- Errors: signature mismatch, duplicate delivery id.

### `GET /api/github/events/[projectId]`

- Auth: Session + membership.
- Response:

```ts
interface GitHubEventsResponse {
  events: Array<{
    id: string;
    type: "PUSH" | "PR" | "ISSUE" | "REVIEW";
    processed: boolean;
    taskCreated: boolean;
    createdAt: string;
  }>;
}
```

- DB: query recent `GitHubEvent`.
- Errors: unauthorized scope.

### `POST /api/rag/embed`

- Auth: Session/service token.
- Request:

```ts
interface RagEmbedRequest {
  projectId: string;
  type: "TASK" | "DOC" | "ISSUE" | "COMMIT";
  externalId?: string;
  text: string;
  metadata?: Record<string, string | number | boolean>;
}
```

- Response:

```ts
interface RagEmbedResponse {
  vectorId: string;
  dimension: number;
}
```

- DB: insert `VectorDocument`.
- Pinecone: embed + upsert.
- Errors: embedding provider error, Pinecone upsert failure.

### `POST /api/rag/query`

- Auth: Session/service token.
- Request:

```ts
interface RagQueryRequest {
  projectId: string;
  query: string;
  topK?: number;
  minScore?: number;
}
```

- Response:

```ts
interface RagQueryResponse {
  matches: Array<{
    vectorId: string;
    score: number;
    content: string;
    metadata: Record<string, unknown>;
  }>;
}
```

- Pinecone: query namespace.
- DB: optional hydration by vector ids.
- Errors: invalid project namespace.

### `GET /api/team/[projectId]`

- Auth: Session + membership.
- Response:

```ts
interface TeamResponse {
  members: Array<{
    memberId: string;
    userId: string;
    name: string;
    skills: string[];
    currentLoad: number;
    performanceScore: number;
    availableFrom?: string;
  }>;
}
```

- DB: join `TeamMember`, `User`, assignments.
- Redis: optional load overlay.

### `PATCH /api/team/[memberId]/skills`

- Auth: Session + OWNER/ADMIN.
- Request:

```ts
interface UpdateSkillsRequest {
  skills: string[];
}
```

- Response:

```ts
interface UpdateSkillsResponse {
  memberId: string;
  skills: string[];
}
```

- DB: update `TeamMember.skills`.
- Errors: invalid skill payload.

### `GET /api/alerts/[projectId]`

- Auth: Session + membership.
- Response:

```ts
interface AlertsResponse {
  alerts: Array<{
    id: string;
    taskId?: string;
    type: "BLOCKER" | "INACTIVITY" | "SLA_BREACH" | "OVERLOAD";
    severity: "CRITICAL" | "WARNING" | "INFO";
    message: string;
    resolved: boolean;
    createdAt: string;
  }>;
}
```

- DB: query open alerts first, then historical.
- Redis: read cached counts.

### `PATCH /api/alerts/[id]/resolve`

- Auth: Session + member role.
- Request:

```ts
interface ResolveAlertRequest {
  resolutionNote?: string;
}
```

- Response:

```ts
interface ResolveAlertResponse {
  id: string;
  resolved: boolean;
  resolvedAt: string;
}
```

- DB: mark alert resolved.
- Inngest: emit `alert.resolved`.
- Redis: invalidate project alert count.

### `GET /api/analytics/[projectId]`

- Auth: Session + membership.
- Response:

```ts
interface AnalyticsResponse {
  burndown: Array<{ date: string; remainingPoints: number }>;
  velocity: Array<{ sprintId: string; completedPoints: number }>;
  cycleTime: { averageHours: number };
  throughput: { tasksPerWeek: number };
  agentRoi: {
    autoCreated: number;
    manualCreated: number;
    timeSavedHoursEstimate: number;
  };
}
```

- DB: aggregate tasks/sprints/agent runs.
- Redis: optional materialized metrics cache.

### `POST /api/inngest`

- Auth: Inngest signing verification.
- Request: Inngest control payload.
- Response: function registration and invocation outputs.
- DB: middleware writes to `AgentRun` and `AgentLog`.
- Errors: invalid signing key, malformed function response.

---

## 7. Three AI Agents - Complete Implementation Detail

### 7a. Task Generation Agent

- Inngest function id: `task-generation-agent`
- Trigger events: `github.push`, `github.pr.opened`, `github.issue.created`
- Concurrency: key by `projectId`, limit 2
- Retries: 3
- Backoff: exponential (`2s`, `10s`, `30s`)

#### Execution flow (pseudocode)

```ts
async function taskGenerationAgent(event: GitHubEventPayload): Promise<void> {
  const rateKey = `rate:github:${event.installationId}`;
  await enforceRateLimit(rateKey, 20, 60);

  const run = await createAgentRun("TASK_GEN", event.projectId, event);

  try {
    const context = parseGitHubPayload(event); // branch, commits, PR body, issue body
    const normalizedText = buildContextText(context);

    const queryVector = await embedText(normalizedText);
    const similar = await pineconeQuery({
      namespace: event.projectId,
      vector: queryVector,
      topK: 5,
      minScore: 0.85,
    });

    if (similar.some((m) => m.score > 0.9)) {
      await log(run.id, "INFO", "Skipped duplicate task candidate", {
        similar,
      });
      return;
    }

    const prompt = buildTaskPrompt(context, similar);
    const llmResult = await callOpenAI(prompt);
    const taskDraft = parseStructuredTask(llmResult);

    await enforcePerEventTaskLimit(event.id, 10); // Redis counter

    const task = await db.task.create({
      data: mapDraftToTask(taskDraft, event.projectId),
    });

    const taskVector = await embedText(`${task.title}\n${task.description}`);
    await pineconeUpsert({
      id: `task:${task.id}`,
      namespace: event.projectId,
      values: taskVector,
      metadata: {
        projectId: event.projectId,
        type: "TASK",
        taskId: task.id,
        createdAt: new Date().toISOString(),
      },
    });

    await inngest.send({
      name: "task.created",
      data: { taskId: task.id, projectId: event.projectId },
    });
    await log(run.id, "SUCCESS", "Task generated", { taskId: task.id });
  } catch (err) {
    await log(run.id, "ERROR", "Task generation failed", maskError(err));
    throw err;
  }
}
```

#### Prompt template

```txt
System Prompt:
You are an autonomous Scrum task generation engine for software teams.
Goals:
1) Generate actionable non-duplicate tasks from GitHub activity.
2) Use provided similar-task context to avoid duplicates.
3) Return strict JSON that matches schema.
4) Keep descriptions implementation-ready.

JSON Schema:
{
  "title": "string",
  "description": "string",
  "type": "STORY|BUG|TASK|SPIKE",
  "priority": "CRITICAL|HIGH|MEDIUM|LOW",
  "effortPoints": "number 1-13",
  "requiredSkills": ["string"]
}

User Prompt Template:
Project: {{projectName}}
GitHub Event Type: {{eventType}}
Branch: {{branchName}}
Commit Messages: {{commitMessages}}
Diff Summary: {{diffSummary}}
Issue/PR Body: {{issueOrPrBody}}
Existing Similar Tasks (score >= 0.85):
{{similarTasks}}

Instructions:
- If likely duplicate, produce a task that references distinction clearly.
- Do not output markdown.
- Output valid JSON only.
```

#### Error handling and retry

1. All transient provider errors throw and rely on Inngest retry policy.
2. Parse errors are logged with `WARN`; if unrecoverable, mark run `FAILED`.
3. Pinecone failures can trigger compensation: task insert rollback or follow-up reconciliation job.
4. Redis counter failures default to safe mode (deny generation after threshold uncertainty).

#### Rate limiting

1. Redis key `rate:github:{installationId}` tracks per-minute event throughput.
2. Task cap per event uses key `rate:taskgen:event:{eventId}` with max 10.

### 7b. Auto Assignment Agent

- Inngest function id: `auto-assignment-agent`
- Trigger event: `task.created`
- Concurrency: key by `projectId`, limit 4
- Retry: 3 with exponential backoff

#### Execution flow (pseudocode)

```ts
async function autoAssignmentAgent(event: {
  taskId: string;
  projectId: string;
  workspaceId: string;
}): Promise<void> {
  const run = await createAgentRun("AUTO_ASSIGN", event.projectId, event);

  const task = await db.task.findUniqueOrThrow({ where: { id: event.taskId } });
  const requiredSkills = extractRequiredSkills(task.description);
  const members = await fetchProjectTeamMembers(event.projectId);

  const scored = [] as Array<{
    userId: string;
    score: number;
    loadPct: number;
  }>;

  for (const member of members) {
    const skillMatch = jaccard(requiredSkills, member.skills);
    const loadKey = `load:${event.workspaceId}:${member.userId}`;
    const rawLoad = await redis.getInt(loadKey, member.currentLoad);
    const normalizedLoad = normalizeLoad(rawLoad); // 0..1
    const perf = clamp(member.performanceScore, 0, 1);

    const composite =
      skillMatch * 0.5 + (1 - normalizedLoad) * 0.3 + perf * 0.2;
    scored.push({
      userId: member.userId,
      score: composite,
      loadPct: normalizedLoad * 100,
    });
  }

  const candidates = scored
    .filter((x) => x.loadPct < 85)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) {
    await inngest.send({
      name: "alert.triggered",
      data: {
        projectId: event.projectId,
        taskId: event.taskId,
        type: "OVERLOAD",
        severity: "WARNING",
      },
    });
    await log(run.id, "WARN", "All members overloaded", {
      taskId: event.taskId,
    });
    return;
  }

  const best = candidates[0];

  await db.$transaction([
    db.task.update({
      where: { id: task.id },
      data: { assigneeId: best.userId },
    }),
    db.taskAssignment.create({
      data: {
        taskId: task.id,
        userId: best.userId,
        assignedByAgent: true,
        matchScore: best.score,
      },
    }),
  ]);

  await redis.incr(`load:${event.workspaceId}:${best.userId}`);
  await inngest.send({
    name: "task.assigned",
    data: { taskId: task.id, assigneeId: best.userId, score: best.score },
  });
  await log(run.id, "SUCCESS", "Task assigned", {
    taskId: task.id,
    assigneeId: best.userId,
    score: best.score,
  });
}
```

#### Redis workload key schema

1. `load:{workspaceId}:{userId}` -> integer task count.
2. Increment on assignment.
3. Decrement when tasks move to `DONE` or are unassigned.

#### Rebalancing conditions

1. Trigger if member load exceeds 90% for more than 30 minutes.
2. Trigger if critical task assigned to overloaded member and alternate candidate >= 0.75 score.
3. Rebalance flow emits `task.reassignment.requested` (internal) then updates assignment.

### 7c. Monitoring Agent

- Inngest function id: `monitoring-agent`
- Triggers:
  - Cron: every 15 minutes
  - Event: `task.updated`
- Concurrency: key by `projectId`, limit 2

#### Execution flow (pseudocode)

```ts
async function monitoringAgent(input: { projectId?: string }): Promise<void> {
  const projects = input.projectId
    ? [input.projectId]
    : await fetchActiveProjects();

  for (const projectId of projects) {
    const activeTasks = await fetchActiveSprintTasks(projectId);

    for (const task of activeTasks) {
      if (
        task.status === "IN_PROGRESS" &&
        olderThan(task.updatedAt, 24, "hours")
      ) {
        await createDedupedAlert(
          projectId,
          task.id,
          "INACTIVITY",
          "WARNING",
          "Task inactive for >24h",
        );
      }

      if (task.dueDate && isPast(task.dueDate) && task.status !== "DONE") {
        await createDedupedAlert(
          projectId,
          task.id,
          "SLA_BREACH",
          "CRITICAL",
          "Task past due date",
        );
        await triggerAutoReassign(task.id, projectId);
      }

      if (task.status === "BLOCKED" && olderThan(task.updatedAt, 4, "hours")) {
        await createDedupedAlert(
          projectId,
          task.id,
          "BLOCKER",
          "CRITICAL",
          "Task blocked >4h",
        );
      }
    }

    const repo = await getProjectRepo(projectId);
    const oldPrs = await githubListOpenPrsOlderThan(repo, 48);
    for (const pr of oldPrs) {
      await createProjectAlert(
        projectId,
        "INACTIVITY",
        "INFO",
        `PR #${pr.number} pending review >48h`,
      );
      await githubComment(
        repo,
        pr.issueNumber,
        "AASM detected review delay. Please triage.",
      );
    }

    const velocity = await computeSprintVelocity(projectId);
    await redis.setEx(
      `sprint:velocity:${velocity.sprintId}`,
      300,
      velocity.score.toString(),
    );

    const openCount = await countOpenAlerts(projectId);
    await redis.setEx(
      `dashboard:alerts:${projectId}`,
      60,
      openCount.toString(),
    );
  }
}
```

#### GitHub API calls used

1. `GET /repos/{owner}/{repo}/pulls` with query `state=open`.
2. `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`.
3. `GET /repos/{owner}/{repo}/commits`.

Auth method: GitHub App installation access token (JWT app auth -> installation token exchange).

#### Alert dedup logic

1. Redis SET key: `alert:dedup:{projectId}:{taskId}:{alertType}`.
2. Use `SET key 1 NX EX 3600`.
3. If command fails to set (already exists), skip duplicate alert insert.

---

## 8. Inngest Event System - Complete Reference

### Function registry

| Function ID                | Trigger                                                                       | Concurrency       | Retry | Throttle                | Steps                                                                   | Emits                              |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------- | ----- | ----------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `github-webhook-router`    | `github.push`, `github.pr.opened`, `github.issue.created`, `github.pr.merged` | 10 global         | 2     | 100/min                 | validate payload, map event, persist routing log                        | task-gen triggers                  |
| `task-generation-agent`    | `github.push`, `github.pr.opened`, `github.issue.created`                     | 2 per `projectId` | 3 exp | 50/min per installation | parse payload, fetch similar vectors, call LLM, insert task, emit event | `task.created`                     |
| `auto-assignment-agent`    | `task.created`                                                                | 4 per `projectId` | 3 exp | 200/min                 | fetch team, score members, persist assignment, update redis             | `task.assigned`                    |
| `monitoring-agent`         | cron `*/15 * * * *`, `task.updated`                                           | 2 per `projectId` | 2     | 100/min                 | scan active tasks, detect risks, create alerts, optional reassign       | `alert.triggered`, `task.assigned` |
| `alert-resolver-sync`      | `alert.resolved`                                                              | 20 global         | 1     | 300/min                 | mark external references resolved, audit log                            | none                               |
| `sprint-lifecycle-handler` | `sprint.started`, `sprint.completed`                                          | 5 global          | 2     | 30/min                  | initialize sprint metrics, finalize analytics snapshot                  | analytics events                   |
| `rag-embed-batch-worker`   | `agent.rag.embed`                                                             | 3 per `projectId` | 3     | 60/min                  | pop queue, chunk text, embed vectors, upsert pinecone                   | none                               |

### Event catalog

1. `github.push`
2. `github.pr.opened`
3. `github.issue.created`
4. `github.pr.merged`
5. `task.created`
6. `task.updated`
7. `task.assigned`
8. `task.blocked`
9. `alert.triggered`
10. `alert.resolved`
11. `sprint.started`
12. `sprint.completed`
13. `agent.rag.embed`

### Middleware: Agent run logging

Every function invocation passes through middleware:

1. Before execution: create `AgentRun` with `RUNNING`.
2. During steps: append `AgentLog` entries for `INFO/WARN/ERROR/SUCCESS`.
3. On success: set `AgentRun.status=COMPLETED`, store output and duration.
4. On failure: set `AgentRun.status=FAILED`, capture sanitized error metadata.

---

## 9. RAG Pipeline - Complete Specification

### Embedding configuration

1. Model: `text-embedding-3-small`.
2. Dimensions: 1536.
3. Similarity metric: cosine.
4. Index class: Pinecone pod `p1`.

### Data sources embedded

1. Task title + description.
2. GitHub issue bodies.
3. Commit messages and summarized diffs.
4. Documentation content pages.
5. Pull request descriptions.

### Embedding triggers

1. On task creation.
2. On GitHub event processing.
3. On manual document upload.
4. On explicit API call to `/api/rag/embed`.

### Query flow for duplicate prevention

1. Construct context text from event payload.
2. Generate embedding.
3. Query Pinecone top-5 for namespace `projectId`.
4. Filter by score threshold.
5. Inject matches into LLM prompt as historical context.
6. Apply duplicate guard (>0.9 likely duplicate).

### Pinecone metadata schema

```json
{
  "projectId": "proj_123",
  "type": "TASK|DOC|ISSUE|COMMIT",
  "externalId": "gh_issue_789",
  "createdAt": "2026-03-26T10:00:00.000Z",
  "taskId": "task_456"
}
```

### Namespace strategy

1. Namespace per `projectId`.
2. Cross-project query disabled by default.
3. Optional admin analytics can run across namespaces using service jobs only.

### Chunking strategy

1. 500-token chunks.
2. 50-token overlap.
3. Preserve sentence boundaries when possible.
4. Keep source reference metadata per chunk.

### `/api/rag/embed` behavior

1. Validate auth + project scope.
2. Validate text length and metadata constraints.
3. Chunk text if needed.
4. Embed chunks and upsert vectors.
5. Save `VectorDocument` rows.
6. Return vector ids and counts.

### `/api/rag/query` behavior

1. Validate auth + project scope.
2. Embed query text.
3. Query Pinecone with `topK` and optional min score.
4. Hydrate with `VectorDocument` content.
5. Return score-ordered matches.

---

## 10. Redis Usage - Complete Reference

| Key pattern                                    | Type         | TTL            | Set by                                         | Read by                          | Invalidated by                  |
| ---------------------------------------------- | ------------ | -------------- | ---------------------------------------------- | -------------------------------- | ------------------------------- |
| `session:{sessionId}`                          | Hash/JSON    | Session expiry | NextAuth session callback                      | API auth middleware              | Sign-out/session revoke         |
| `load:{workspaceId}:{userId}`                  | Integer      | None           | Auto Assignment Agent, manual assignment route | Team page, Auto Assignment Agent | Decrement on task done/unassign |
| `alert:dedup:{projectId}:{taskId}:{alertType}` | String/flag  | 3600s          | Monitoring Agent                               | Monitoring Agent                 | Natural TTL expiry              |
| `dashboard:alerts:{projectId}`                 | Integer      | 60s            | Monitoring Agent, alert routes                 | Dashboard/monitor APIs           | Alert create/resolve events     |
| `agent:status:{projectId}:{agentType}`         | String       | 300s           | Inngest middleware                             | Agents status API/page           | Run complete/failure updates    |
| `rate:github:{installationId}`                 | Counter      | 60s            | Webhook and Task Gen entrypoint                | Task Gen/webhook                 | Automatic TTL                   |
| `sprint:velocity:{sprintId}`                   | Float/String | 300s           | Monitoring analytics step                      | Analytics API                    | Sprint close, recalculation     |
| `rag:embed:queue`                              | List         | None           | API ingest and batch jobs                      | RAG embed worker                 | Popped by worker                |

Operational notes:

1. Use atomic operations (`INCR`, `DECR`, `SET NX EX`) for race safety.
2. Use project/workspace-scoped keys to prevent tenant leakage.
3. Keep TTL intentionally short for volatile dashboard metrics.

---

## 11. GitHub Integration - Complete Specification

### GitHub App permissions

Required permissions:

1. Issues: Read/Write
2. Pull Requests: Read/Write
3. Contents: Read
4. Metadata: Read

### Webhook subscriptions

1. `push`
2. `pull_request`
3. `issues`
4. `pull_request_review`

### Webhook handler contract (`/api/github/webhook`)

1. Read raw request body bytes.
2. Compute HMAC SHA-256 with `GITHUB_WEBHOOK_SECRET`.
3. Compare with `X-Hub-Signature-256` using timing-safe comparison.
4. Extract `X-GitHub-Delivery` for idempotency.
5. Check if `deliveryId` already exists in `GitHubEvent`.
6. If new, persist payload and map event type.
7. Emit Inngest event (`github.push`, `github.pr.opened`, etc.).

### Idempotency policy

1. `GitHubEvent.deliveryId` is unique.
2. Duplicate delivery returns success with `accepted=false` and no reprocessing.

### Monitoring agent GitHub API usage

1. `GET /repos/{owner}/{repo}/pulls` for stale review detection.
2. `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` for SLA/blocker comments.
3. `GET /repos/{owner}/{repo}/commits` for recent activity baseline.

### OAuth login flow

1. User clicks GitHub sign-in.
2. NextAuth starts OAuth authorization code flow.
3. Callback exchanges code for token and profile.
4. User account upsert + session creation.

### App installation flow

1. Admin connects project to GitHub App installation.
2. Installation id is saved in `Project.githubInstallationId`.
3. Runtime agent obtains installation token using app private key.

### Rate limit handling

1. Inspect `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers.
2. If remaining <100, queue downstream operations through Inngest delayed step.
3. Use fallback retries after reset window.

---

## 12. Deployment - Complete Guide

### Vercel deployment

#### Example `vercel.json`

```json
{
  "framework": "nextjs",
  "functions": {
    "app/api/agents/task-gen/trigger/route.ts": { "maxDuration": 60 },
    "app/api/agents/auto-assign/trigger/route.ts": { "maxDuration": 60 },
    "app/api/agents/monitor/trigger/route.ts": { "maxDuration": 60 },
    "app/api/inngest/route.ts": { "maxDuration": 60 }
  }
}
```

#### Vercel setup steps

1. Import repository into Vercel.
2. Set root directory if monorepo.
3. Build command: `npm run build`.
4. Output: `.next`.
5. Add all required environment variables.
6. Configure preview/production variable scopes.
7. Enable Node.js runtime for API routes requiring SDKs and raw body parsing.

#### Runtime decisions

1. Use Node.js runtime for auth, GitHub webhook, Inngest, Pinecone, OpenAI routes.
2. Edge runtime only for lightweight read-only routes without Node-only dependencies.

### PostgreSQL (Supabase/Railway/Neon)

1. Create managed Postgres instance.
2. Copy connection string to `DATABASE_URL`.
3. Enable SSL.
4. Configure connection pooling for serverless workloads (pgBouncer or provider pool endpoint).
5. Run migrations:

```bash
npx prisma generate
npx prisma migrate deploy
```

### Redis (Upstash)

1. Create Redis database in same region as Vercel app.
2. Choose access mode:
   - REST mode for serverless simplicity.
   - Native Redis URL for high-throughput operations.
3. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or `REDIS_URL`).

Recommendation:

- Use REST mode for easy deployment and lower connection management overhead.
- Use native Redis only if workload requires advanced commands/throughput.

### Pinecone

1. Create index with dimension 1536 and cosine metric.
2. Choose pod type `p1` (or equivalent production class).
3. Set API key and environment variables.
4. Initialize namespace lazily per project at first upsert.

### Inngest

1. Register app in Inngest dashboard.
2. Configure event/signing keys.
3. Set callback endpoint to `/api/inngest`.
4. Use local dev server for function development.

### GitHub App

1. Create GitHub App in organization settings.
2. Configure permissions and webhook events.
3. Set webhook URL to deployed `/api/github/webhook`.
4. Generate private key and store secure PEM value in env.
5. Install app on required repositories.

---

## 13. Local Development Setup

### Step-by-step bootstrap

1. Clone repository:

```bash
git clone <repo-url>
cd Agile_Scrum_Master
```

2. Install dependencies:

```bash
npm install
```

3. Create local env file:

```bash
cp .env.example .env.local
```

4. Fill `.env.local` using template below.
5. Start Postgres/Redis locally or use managed instances.
6. Run Prisma migrations and generate client.
7. Start Next.js dev server.
8. Start Inngest dev server.
9. Expose webhook endpoint using ngrok for GitHub webhooks.

### `.env.local` template

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/aasm?schema=public
REDIS_URL=rediss://default:token@your-redis-host:6379
NEXTAUTH_SECRET=replace_with_strong_random_secret
NEXTAUTH_URL=http://localhost:3000

GITHUB_CLIENT_ID=replace_with_oauth_client_id
GITHUB_CLIENT_SECRET=replace_with_oauth_client_secret
GITHUB_WEBHOOK_SECRET=replace_with_webhook_secret
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

OPENAI_API_KEY=sk-proj-xxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxx

PINECONE_API_KEY=pcsk_xxxxx
PINECONE_ENVIRONMENT=us-east-1-aws
PINECONE_INDEX_NAME=aasm-main-index

INNGEST_EVENT_KEY=evt_xxxxx
INNGEST_SIGNING_KEY=signkey_xxxxx
INNGEST_BASE_URL=http://127.0.0.1:8288

UPSTASH_REDIS_REST_URL=https://example.upstash.io
UPSTASH_REDIS_REST_TOKEN=token_here

NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000/ws
```

### Prisma and dev commands

```bash
npx prisma generate
npx prisma migrate dev
npm run dev
```

### Inngest dev server

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

### ngrok for GitHub webhook local testing

```bash
ngrok http 3000
```

Set GitHub App webhook URL to `https://<ngrok-id>.ngrok.io/api/github/webhook`.

### Seed script behavior

A seed script should create:

1. Demo user and workspace.
2. Workspace members with varied roles.
3. One project linked to mock GitHub metadata.
4. Active sprint and backlog tasks.
5. Team members with skill arrays and performance scores.
6. Initial `AgentRun` and `AgentLog` records for dashboard realism.

---

## 14. Feature Comparison - Competitor Analysis

| Feature                             | AASM                                  | Jira                       | Linear                          | Asana      | ClickUp           | Monday      |
| ----------------------------------- | ------------------------------------- | -------------------------- | ------------------------------- | ---------- | ----------------- | ----------- |
| AI task generation from code events | Native autonomous                     | Limited add-ons            | Limited                         | No native  | Partial AI assist | Limited     |
| Auto-assignment intelligence        | Skill+load+perf model                 | Rule-driven                | Basic                           | Basic      | Basic             | Basic       |
| Real-time blocker detection         | Yes, continuous                       | Workflow dependent         | Partial                         | Partial    | Partial           | Partial     |
| RAG context awareness               | Native Pinecone                       | Rare via plugin            | No native                       | No native  | No native         | No native   |
| Inngest event architecture          | Native                                | No                         | No                              | No         | No                | No          |
| GitHub integration depth            | Webhook + app + comments + PR checks  | Strong but less autonomous | Strong sync                     | Moderate   | Moderate          | Moderate    |
| Sprint velocity prediction          | Native agent analytics                | Dashboards, mostly manual  | Analytics present               | Basic      | Basic             | Basic       |
| Zero-duplicate task guarantee       | Similarity guardrail and dedup checks | No strict guarantee        | No strict guarantee             | No         | No                | No          |
| Auto-reassignment on SLA breach     | Yes                                   | Custom automation required | Limited                         | No native  | Limited           | Limited     |
| Per-agent configurability           | Per-project JSON config               | Workflow config only       | Limited                         | Limited    | Limited           | Limited     |
| Pricing model orientation           | Developer-first AI automation ROI     | Seat + add-on heavy        | Seat-based                      | Seat-based | Seat-based        | Seat-based  |
| Developer-first workflow            | GitHub-native and code-aware          | Mixed PM + dev             | Dev-focused but less autonomous | PM-focused | Generalized       | Generalized |

---

## 15. Security Considerations

### Webhook security

1. All inbound webhooks require HMAC verification.
2. Use raw body verification to prevent canonicalization mismatch.
3. Reject missing signature headers with `401`.

### API route auth pattern

1. Session middleware validates identity.
2. Workspace/project authorization enforced before data access.
3. Service-token routes use rotating token validation and strict allowlists.

### Database security

1. Prisma ORM queries are parameterized.
2. No raw unparameterized SQL allowed.
3. Every tenant query must include workspace/project scope checks.

### Secret handling

1. Secrets only via environment variables.
2. Never log raw secrets; mask in logs.
3. Agent logs sanitize provider errors.

### Tenant isolation

1. DB-level scoping by `workspaceId`.
2. Redis key scoping by workspace/project.
3. Pinecone namespace isolation by `projectId`.

### Rate limiting and abuse prevention

1. Redis-based per installation and endpoint rate limits.
2. Prevent event storms from creating task floods.
3. Use idempotency keys for webhook deliveries.

### Error response hygiene

All client-facing failures return structured non-sensitive error bodies:

```json
{
  "error": "Forbidden",
  "code": 403,
  "detail": "You do not have access to this workspace"
}
```

No stack traces are exposed to clients.

---

## Appendix A: Type Contracts and Enums

```ts
type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

type SprintStatus = "PLANNING" | "ACTIVE" | "COMPLETED";

type TaskType = "STORY" | "BUG" | "TASK" | "SPIKE";

type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "BLOCKED";

type TaskPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type AgentType = "TASK_GEN" | "AUTO_ASSIGN" | "MONITOR";

type AgentRunStatus = "RUNNING" | "COMPLETED" | "FAILED";

type AlertType = "BLOCKER" | "INACTIVITY" | "SLA_BREACH" | "OVERLOAD";

type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";
```

---

## Appendix B: Suggested CI/CD (GitHub Actions)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test -- --ci
      - run: npm run build
```

```yaml
name: Deploy Vercel

on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: "--prod"
```

---

## Appendix C: Extension Checklist for New Developers

1. Create new agent type:
   - Add enum values.
   - Add Inngest function.
   - Add status key handling and UI `AgentCard` support.
2. Add new alert type:
   - Extend enum and dedup key rules.
   - Update monitoring logic and monitor page filters.
3. Add new external event source:
   - Implement webhook endpoint with HMAC verification.
   - Persist source event model.
   - Map to Inngest canonical event.
4. Add new analytics metric:
   - Add DB aggregate query.
   - Add cache key and invalidation rule.
   - Render chart card in analytics page.

---

This document is intended to function as the definitive implementation reference for AASM. It can be used to onboard a new engineer from zero context through architecture understanding, local setup, API contracts, AI orchestration behavior, security controls, and production deployment patterns.
