# Automated Agentic Scrum Master Docs — Code Documentation

## 1. Project File Tree

```text
docs/
  aasm-project-bible.md
  aasm-pages-reference.md
```

## 2. File Analysis

### 2.1 docs/aasm-project-bible.md

#### File path

- docs/aasm-project-bible.md

#### Purpose

- Markdown documentation file describing product overview, architecture, schema examples, API contracts, agent pseudocode, event catalogs, Redis key specs, deployment notes, and setup instructions.

#### Exports

- None. This file is Markdown and has no JavaScript or TypeScript module exports.

#### Functions

- Runtime functions: None.
- Snippet functions present inside fenced code blocks (documentation examples only):

1. taskGenerationAgent

- Exact name: taskGenerationAgent
- Parameters with types: event: GitHubEventPayload
- Return type: Promise<void>
- What it does line by line in plain English:
  - Builds a Redis rate-limit key using installationId.
  - Calls enforceRateLimit(rateKey, 20, 60).
  - Creates an agent run record via createAgentRun("TASK_GEN", event.projectId, event).
  - Parses GitHub payload into context via parseGitHubPayload(event).
  - Builds normalized text via buildContextText(context).
  - Embeds text via embedText(normalizedText).
  - Queries Pinecone via pineconeQuery with namespace=projectId, topK=5, minScore=0.85.
  - Checks if any match score is greater than 0.9.
  - Logs duplicate skip and returns early when duplicate condition is true.
  - Builds LLM prompt via buildTaskPrompt(context, similar).
  - Calls OpenAI via callOpenAI(prompt).
  - Parses model output via parseStructuredTask(llmResult).
  - Enforces per-event cap via enforcePerEventTaskLimit(event.id, 10).
  - Inserts task via db.task.create(data: mapDraftToTask(...)).
  - Embeds final task text via embedText("title + description").
  - Upserts Pinecone vector with id task:{task.id} and metadata fields.
  - Emits Inngest event task.created via inngest.send.
  - Writes success log via log(..., "SUCCESS", ...).
  - On error: logs error via log(..., "ERROR", ...) and rethrows.
- External services called in snippet:
  - Redis (rate limit and per-event cap helper calls)
  - Pinecone (query, upsert)
  - OpenAI (via callOpenAI and embedding helper)
  - PostgreSQL/Prisma (db.task.create)
  - Inngest (inngest.send)
- Reads from and writes to in snippet:
  - Reads event payload fields.
  - Writes task row in DB.
  - Writes vector in Pinecone.
  - Writes logs.
  - Writes emitted event to Inngest.
- Error handling present:
  - Yes. try/catch with error log and throw.

2. autoAssignmentAgent

- Exact name: autoAssignmentAgent
- Parameters with types: event: { taskId: string; projectId: string; workspaceId: string }
- Return type: Promise<void>
- What it does line by line in plain English:
  - Creates agent run via createAgentRun("AUTO_ASSIGN", ...).
  - Fetches task with db.task.findUniqueOrThrow.
  - Extracts required skills from task description.
  - Fetches team members.
  - Initializes score collection array.
  - Iterates members.
  - Computes Jaccard skill match for each member.
  - Builds Redis load key load:{workspaceId}:{userId}.
  - Reads load from Redis with fallback to currentLoad.
  - Normalizes load and clamps performance score.
  - Computes composite score.
  - Pushes candidate score object.
  - Filters candidates with loadPct < 85.
  - Sorts candidates by score descending.
  - If no candidates:
    - Emits alert.triggered via inngest.send.
    - Logs warning.
    - Returns.
  - Selects top candidate.
  - Executes DB transaction:
    - Updates task assignee.
    - Creates TaskAssignment row.
  - Increments Redis load key for selected user.
  - Emits task.assigned event via inngest.send.
  - Writes success log.
- External services called in snippet:
  - PostgreSQL/Prisma (findUniqueOrThrow, update, create, transaction)
  - Redis (getInt, incr)
  - Inngest (send)
- Reads from and writes to in snippet:
  - Reads task and team data.
  - Reads/writes Redis load keys.
  - Writes task assignment in DB.
  - Writes events and logs.
- Error handling present:
  - No explicit try/catch in shown snippet.

3. monitoringAgent

- Exact name: monitoringAgent
- Parameters with types: input: { projectId?: string }
- Return type: Promise<void>
- What it does line by line in plain English:
  - Builds project list from input.projectId or fetchActiveProjects().
  - Iterates each project.
  - Fetches active sprint tasks.
  - Iterates tasks and checks inactivity condition.
  - Creates INACTIVITY alert when inactive >24h.
  - Checks SLA breach condition dueDate < now and not DONE.
  - Creates SLA_BREACH alert and triggers reassignment.
  - Checks BLOCKED duration >4h and creates BLOCKER alert.
  - Fetches repo info.
  - Fetches open PRs older than 48h.
  - Creates project-level inactivity alerts for stale PR reviews.
  - Posts GitHub comment for stale PR.
  - Computes sprint velocity.
  - Writes velocity into Redis with TTL 300.
  - Counts open alerts.
  - Writes dashboard alert count into Redis with TTL 60.
- External services called in snippet:
  - PostgreSQL (through helper functions for task/alert metrics)
  - Redis (setEx)
  - GitHub API (PR listing and comments through helper functions)
- Reads from and writes to in snippet:
  - Reads tasks and repo data.
  - Writes alert records through helper functions.
  - Writes Redis metrics keys.
- Error handling present:
  - No explicit try/catch in shown snippet.

#### API calls made

- This file is documentation text; no executable network request code exists at file runtime.
- Referenced API endpoints in text and examples:
  - POST /api/auth/[...nextauth]
  - GET /api/workspaces
  - POST /api/workspaces
  - GET /api/workspaces/[id]/projects
  - POST /api/projects
  - GET /api/projects/[id]/sprints
  - POST /api/sprints
  - GET /api/sprints/[id]/tasks
  - POST /api/tasks
  - PATCH /api/tasks/[id]
  - DELETE /api/tasks/[id]
  - POST /api/tasks/[id]/assign
  - GET /api/projects/[id]/agents/status
  - POST /api/agents/task-gen/trigger
  - POST /api/agents/auto-assign/trigger
  - POST /api/agents/monitor/trigger
  - GET /api/agents/[id]/logs
  - POST /api/github/webhook
  - GET /api/github/events/[projectId]
  - POST /api/rag/embed
  - POST /api/rag/query
  - GET /api/team/[projectId]
  - PATCH /api/team/[memberId]/skills
  - GET /api/alerts/[projectId]
  - PATCH /api/alerts/[id]/resolve
  - GET /api/analytics/[projectId]
  - POST /api/inngest
  - External API references in text:
    - GET /repos/{owner}/{repo}/pulls
    - POST /repos/{owner}/{repo}/issues/{issue_number}/comments
    - GET /repos/{owner}/{repo}/commits

#### Database queries

- Runtime DB queries in this Markdown file: None.
- Prisma operations referenced in text/snippets:
  - db.task.create
  - db.task.findUniqueOrThrow
  - db.task.update
  - db.taskAssignment.create
  - db.$transaction

#### Inngest events

- Runtime listeners/emitters in this Markdown file: None.
- Event names referenced in text/snippets:
  - github.push
  - github.pr.opened
  - github.issue.created
  - github.pr.merged
  - task.created
  - task.updated
  - task.assigned
  - task.blocked
  - alert.triggered
  - alert.resolved
  - sprint.started
  - sprint.completed
  - agent.rag.embed

#### Redis operations

- Runtime Redis operations in this Markdown file: None.
- Keys/operations referenced in text/snippets:
  - load:{workspaceId}:{userId}
  - sprint:velocity:{sprintId}
  - dashboard:alerts:{projectId}
  - rate:github:{installationId}
  - rate:taskgen:event:{eventId}
  - alert:dedup:{projectId}:{taskId}:{alertType}
  - session:{sessionId}
  - agent:status:{projectId}:{agentType}
  - rag:embed:queue
  - Operations shown: getInt, incr, setEx, SET NX EX (text)

#### Environment variables used

- process.env.\* references in file code: None.
- Environment variable names documented in text:
  - DATABASE_URL
  - REDIS_URL
  - NEXTAUTH_SECRET
  - NEXTAUTH_URL
  - GITHUB_CLIENT_ID
  - GITHUB_CLIENT_SECRET
  - GITHUB_WEBHOOK_SECRET
  - GITHUB_APP_ID
  - GITHUB_APP_PRIVATE_KEY
  - OPENAI_API_KEY
  - ANTHROPIC_API_KEY
  - PINECONE_API_KEY
  - PINECONE_ENVIRONMENT
  - PINECONE_INDEX_NAME
  - INNGEST_EVENT_KEY
  - INNGEST_SIGNING_KEY
  - INNGEST_BASE_URL
  - UPSTASH_REDIS_REST_URL
  - UPSTASH_REDIS_REST_TOKEN
  - NEXT_PUBLIC_APP_URL
  - NEXT_PUBLIC_WS_URL

#### Dependencies imported

- Import statements: None. This Markdown file has no import declarations.

---

### 2.2 docs/aasm-pages-reference.md

#### File path

- docs/aasm-pages-reference.md

#### Purpose

- Markdown page catalog describing route-level UI structure, component lists, API endpoint references, user actions, agent interactions, and real-time update notes.

#### Exports

- None. This file is Markdown and has no module exports.

#### Functions

- Runtime functions: None.
- Snippet/documented functions: None (no function code blocks defining functions).

#### API calls made

- Runtime calls from this file: None.
- Endpoints referenced in page documentation:
  - POST /api/auth/[...nextauth]
  - POST /api/workspaces
  - POST /api/projects
  - GET /api/workspaces
  - GET /api/alerts/[projectId]
  - GET /api/projects/[id]/agents/status
  - GET /api/sprints/[id]/tasks
  - PATCH /api/tasks/[id]
  - GET /api/projects/[id]/sprints
  - POST /api/tasks
  - DELETE /api/tasks/[id]
  - POST /api/agents/task-gen/trigger
  - POST /api/agents/auto-assign/trigger
  - POST /api/agents/monitor/trigger
  - GET /api/agents/[id]/logs
  - GET /api/team/[projectId]
  - GET /api/github/events/[projectId]
  - PATCH /api/alerts/[id]/resolve
  - PATCH /api/team/[memberId]/skills
  - GET /api/analytics/[projectId]

#### Database queries

- None present in file content.

#### Inngest events

- None emitted/listened by code (Markdown only).
- Event names referenced in text:
  - auth.fail event
  - project.created
  - alert.triggered
  - task.created
  - task.assigned
  - task.updated
  - github.push
  - github.\* events
  - scheduledSweep
  - sprint.completed

#### Redis operations

- None present in file content.

#### Environment variables used

- process.env.\* references: None.

#### Dependencies imported

- Import statements: None.

---

## 3. Cross-File Summary (Exact, Source-Derived)

| Item                      | docs/aasm-project-bible.md | docs/aasm-pages-reference.md |
| ------------------------- | -------------------------- | ---------------------------- |
| File type                 | Markdown                   | Markdown                     |
| Runtime exports           | None                       | None                         |
| Runtime functions         | None                       | None                         |
| Function snippets in text | 3                          | 0                            |
| Runtime imports           | None                       | None                         |
| Runtime DB calls          | None                       | None                         |
| Runtime Redis ops         | None                       | None                         |
| Runtime Inngest usage     | None                       | None                         |
| API endpoints referenced  | Yes                        | Yes                          |
| Env vars listed in text   | Yes                        | No                           |

## 4. Exact Constraints Observed

1. Both provided files are documentation artifacts, not executable source modules.
2. All technical operations in these files are descriptive or illustrative.
3. Any function/query/event/Redis details reported above are present as text examples, not runtime behavior in these two files.
