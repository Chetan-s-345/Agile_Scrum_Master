# GitNexus + E2B Integration — Build Prompts for Agile Scrum Master

> Based on codebase analysis of `Agile_Scrum_Master` (Next.js 16 + PostgreSQL + proxyToApiGateway pattern) and your E2B experience from `SecDev`.

---

## Architecture Overview

```
GitHub Repo
    │
    ▼
[GitNexus Service]  ← runs inside E2B Sandbox (dynamic RAM/CPU)
    │  git clone + analysis (commits, files, blame, PR data)
    │
    ▼
[Nexus Data Mapper]  ← transforms raw git data → sprint task schema
    │
    ▼
[API Gateway]  ← existing asm-api-gateway.onrender.com
    │
    ▼
[Next.js Frontend]  ← existing cloud/ app, new board/code/page.tsx feeds
```

---

## PROMPT 1 — GitNexus Service (Core Git Analysis Engine)

**Use this prompt to build:** `backend/services/git-nexus/nexus.py`

```
You are building GitNexus, a Python service that deeply analyzes a GitHub repository 
inside an E2B sandbox to produce structured sprint task data for an Agile Scrum Master app.

### Context
The app (Agile Scrum Master) already has these tables in PostgreSQL (schema: app):
- app.tasks (id, title, description, tech_tags[], story_points, status, priority, sprint_id, assignee_id)
- app.sprints (id, name, goal, start_date, end_date, status, velocity)
- app.developers (id, name, email, tech_stack[], merit_score, current_sprint_load)

The existing AI routes proxy to an API gateway at /api/v1/ai/sprint-plan and /api/v1/ai/agentic/sprint-build.
GitNexus output must feed into these routes as enriched context.

### What GitNexus must do (in order):
1. Accept: { repo_url, github_token, branch="main", since_days=30 }
2. Clone the repo into the sandbox filesystem
3. Run these analyses and return structured JSON:

   a) COMMIT ANALYSIS
      - Parse last N commits: message, author email, files changed, lines added/deleted
      - Detect conventional commit types: feat/fix/chore/refactor/test/docs
      - Group commits by author email (maps to developers.email)
      
   b) FILE CHANGE HEATMAP
      - Count how many times each file was changed in the window
      - Detect which tech domains each file belongs to:
        frontend: [.tsx, .jsx, .css, .html]
        backend: [.py, .ts route files, .go, .java]
        infra: [.yaml, .yml, Dockerfile, .tf]
        database: [.sql, migration files]
        tests: [*.test.*, *.spec.*]
      
   c) OPEN WORK DETECTOR
      - Scan for TODO/FIXME/HACK/BUG comments across all source files
      - Return: { file, line, type, text, author (from git blame) }
      
   d) DEPENDENCY DRIFT
      - Parse package.json / requirements.txt / go.mod / Cargo.toml
      - Flag packages with known major version gaps (compare installed vs latest via simple heuristic)
      
   e) UNMERGED BRANCHES
      - List branches not merged to main, age in days, last committer email
      
4. Return this exact JSON schema:
{
  "repo_meta": {
    "url": string,
    "branch": string,
    "total_commits_analyzed": number,
    "analysis_window_days": number,
    "repo_size_kb": number,
    "primary_language": string,
    "languages_detected": string[]
  },
  "suggested_tasks": [
    {
      "title": string,           // max 80 chars, action-oriented
      "description": string,     // markdown, 2-4 sentences with evidence
      "tech_tags": string[],     // matches developers.tech_stack values
      "story_points": number,    // 1,2,3,5,8,13 — estimate based on scope
      "priority": "critical"|"high"|"medium"|"low",
      "source": "todo_comment"|"stale_branch"|"hotfile"|"dependency_drift"|"commit_pattern",
      "evidence": {              // raw data that generated this task
        "files": string[],
        "commits": string[],
        "authors": string[]
      },
      "suggested_assignee_email": string|null  // best match from commit authors
    }
  ],
  "developer_insights": [
    {
      "email": string,
      "commits": number,
      "lines_added": number,
      "lines_deleted": number,
      "primary_files": string[],
      "primary_tech": string[],
      "suggested_capacity_points": number   // rough sprint load signal
    }
  ],
  "risk_signals": [
    {
      "type": "bus_factor"|"stale_code"|"test_coverage_gap"|"large_file",
      "severity": "high"|"medium"|"low",
      "detail": string,
      "files": string[]
    }
  ]
}

### Constraints
- Use only stdlib + gitpython + subprocess — no heavy ML libs
- Must complete analysis in under 60 seconds for repos up to 500MB
- Handle private repos via GITHUB_TOKEN in the clone URL
- All file I/O inside /home/user/repo/ (E2B sandbox path)
- Log progress to stdout with emoji prefixes: 🔍 analyzing, ✅ done, ⚠️ warning

Write the full nexus.py file with a main() function that accepts CLI args:
  python nexus.py --repo-url <url> --token <token> --branch main --since-days 30
And prints the final JSON to stdout.
```

---

## PROMPT 2 — E2B Sandbox Manager (Dynamic RAM/CPU Allocation)

**Use this prompt to build:** `backend/services/git-nexus/sandbox_manager.py`

```
You are building a sandbox manager that launches E2B Code Interpreter sandboxes 
with variable resource allocation based on repository size.

### Context
This is used by the Agile Scrum Master app (Next.js + Python API gateway on Render).
The SecDev project pattern for E2B: use e2b_code_interpreter.Sandbox, pass API key via 
E2B_API_KEY env var, run Python scripts via sandbox.notebook.exec_cell() or 
sandbox.commands.run(), stream stdout for progress.

### Resource Tiers (base these on repo_size_kb you detect BEFORE cloning via GitHub API):
| Repo Size     | RAM   | CPU  | Timeout  | E2B Template      |
|---------------|-------|------|----------|-------------------|
| < 10 MB       | 512MB | 0.5  | 120s     | "base"            |
| 10 – 100 MB   | 1GB   | 1.0  | 240s     | "base"            |
| 100 – 500 MB  | 2GB   | 2.0  | 480s     | "base"            |
| > 500 MB      | 4GB   | 4.0  | 900s     | "base"            |

### What to build:
Build a Python class `NexusSandboxManager` with these methods:

1. `estimate_repo_size(repo_url, github_token) -> int`
   - Call GitHub API: GET /repos/{owner}/{repo} → use `size` field (in KB)
   - No cloning needed at this stage

2. `get_resource_config(size_kb: int) -> dict`
   - Returns { ram_mb, cpu, timeout_seconds, tier_name }
   - Use the tier table above

3. async `run_analysis(repo_url, github_token, branch="main", since_days=30) -> dict`
   - Call estimate_repo_size first
   - Create E2B sandbox with correct timeout via: Sandbox(timeout=timeout_seconds)
   - Upload nexus.py into the sandbox via sandbox.files.write()
   - Install deps inside sandbox: subprocess pip install gitpython
   - Run: python nexus.py --repo-url ... --token ... --branch ... --since-days ...
   - Stream stdout lines → yield progress events (for SSE streaming to frontend)
   - Parse final JSON line from stdout
   - Close sandbox
   - Return: { config_used, duration_seconds, result: <nexus JSON> }

4. `get_sandbox_status() -> dict`
   - Return current active sandboxes count and resource usage

### API surface (FastAPI route to add to existing api-gateway):
POST /api/v1/git-nexus/analyze
Body: { repo_url, github_token?, branch, since_days }
Response: SSE stream of { event: "progress"|"complete"|"error", data: ... }

GET /api/v1/git-nexus/status
Response: { active_sandboxes, total_analyses_today }

### Error handling:
- Sandbox timeout → return partial results with timeout flag
- GitHub API 403 → return clear message about token permissions needed
- Repo too large (>2GB) → reject with helpful message

Use e2b_code_interpreter library (from SecDev pattern).
Include full type hints and docstrings.
```

---

## PROMPT 3 — Nexus Data Mapper (Git Data → Sprint Tasks)

**Use this prompt to build:** `backend/services/git-nexus/nexus_mapper.py`

```
You are building a data mapper that takes GitNexus JSON output and maps it into 
the Agile Scrum Master's existing task and sprint schema.

### Existing Schema (PostgreSQL, schema: app):
```sql
app.tasks: id, title, description, tech_tags[], story_points, status, priority, 
           sprint_id, assignee_id, jira_issue_id, created_at
app.developers: id, email, name, tech_stack[], merit_score, current_sprint_load, 
                max_sprint_capacity, avg_completion_rate
app.sprints: id, name, goal, start_date, end_date, status, velocity
```

### What the mapper must do:

1. `match_developers(suggested_tasks, db_developers) -> list[task]`
   - For each suggested_task with suggested_assignee_email:
     - Find the developer in db_developers by email
     - If found: set assignee_id, check current_sprint_load < max_sprint_capacity
     - If over capacity: find next best developer by matching tech_tags ↔ tech_stack
     - If no match: leave assignee_id=null

2. `deduplicate_tasks(suggested_tasks, existing_tasks) -> list[task]`  
   - Compare suggested task titles against existing open tasks using simple fuzzy match
   - (Use difflib.SequenceMatcher — no external libs)
   - Skip tasks with >80% title similarity to existing open ones
   - Log skipped tasks with reason

3. `enrich_descriptions(tasks, repo_meta, risk_signals) -> list[task]`
   - Append to each task description:
     - Source evidence (which files/commits triggered this)
     - Relevant risk signals if any apply to same files
   - Format as clean markdown (will render in TaskDetailDrawer.tsx)

4. `build_sprint_context(nexus_result, current_sprint) -> dict`
   - Merge GitNexus developer_insights with current sprint's velocity
   - Return sprint_context that matches what /api/v1/ai/sprint-plan expects:
   {
     "project_id": string,
     "nexus_enrichment": {
       "commit_velocity": number,       // commits/day in window
       "active_contributors": number,
       "hotspot_files": string[],
       "risk_summary": string,          // 1 sentence for AI prompt injection
       "suggested_sprint_goal": string  // derived from feat: commits
     },
     "suggested_tasks": [ ...mapped tasks... ]
   }

5. `to_api_gateway_payload(sprint_context) -> dict`
   - Format final payload that can be POSTed to existing:
     POST /api/v1/ai/agentic/sprint-build
   - Must match the body schema the existing agentic route expects

### Class interface:
class NexusMapper:
    def __init__(self, db_connection_string: str): ...
    def map_to_sprint(self, nexus_result: dict, project_id: str) -> dict: ...
    def get_match_report(self) -> dict: ...  # stats on what was matched/skipped

Include unit tests in the same file under if __name__ == "__main__": 
using simple assert statements with sample data.
```

---

## PROMPT 4 — Next.js API Route (Frontend Integration)

**Use this prompt to build:** `cloud/app/api/ai/git-nexus/route.ts`

```
You are adding a new Next.js API route to the Agile Scrum Master cloud app.
The app uses this exact pattern for all API routes (follow it strictly):

```typescript
// Existing pattern from cloud/app/api/ai/sprint-plan/route.ts:
import { NextResponse } from "next/server";
import { getAuthTokenFromCookies, proxyToApiGateway } from "@/lib/api-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = await getAuthTokenFromCookies();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  return proxyToApiGateway({
    upstreamPath: "/api/v1/ai/agentic/sprint-build",
    method: "POST",
    token,
    body: body ?? {},
  });
}
```

Create these 3 route files following the exact same pattern:

### File 1: cloud/app/api/ai/git-nexus/analyze/route.ts
- POST handler
- Validates body has: { repo_url: string, project_id: string, branch?: string, since_days?: number }
- Proxies to: POST /api/v1/git-nexus/analyze
- Supports SSE streaming: set headers { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
- Stream the response back as-is (the backend sends SSE progress events)

### File 2: cloud/app/api/ai/git-nexus/status/route.ts
- GET handler
- Proxies to: GET /api/v1/git-nexus/status
- Returns sandbox resource usage info

### File 3: cloud/app/api/ai/git-nexus/tasks/route.ts  
- GET handler
- Query param: project_id (required)
- Proxies to: GET /api/v1/git-nexus/tasks?projectId=...
- Returns the mapped task suggestions ready to inject into the sprint board

### TypeScript types to add to cloud/types/ :
```typescript
// cloud/types/git-nexus.ts
export interface NexusAnalysisRequest {
  repo_url: string;
  project_id: string;
  branch?: string;
  since_days?: number;
}

export interface NexusSuggestedTask {
  title: string;
  description: string;
  tech_tags: string[];
  story_points: number;
  priority: "critical" | "high" | "medium" | "low";
  source: string;
  suggested_assignee_email: string | null;
  evidence: { files: string[]; commits: string[]; authors: string[] };
}

export interface NexusAnalysisResult {
  repo_meta: { url: string; repo_size_kb: number; primary_language: string };
  suggested_tasks: NexusSuggestedTask[];
  developer_insights: object[];
  risk_signals: object[];
  sandbox_config: { tier_name: string; ram_mb: number; duration_seconds: number };
}
```

Keep the implementation minimal and follow the existing proxy pattern exactly.
```

---

## PROMPT 5 — Frontend UI Panel (board/code/page.tsx Enhancement)

**Use this prompt to build:** Updates to `cloud/app/(dashboard)/board/code/page.tsx`

```
You are adding a "GitNexus" panel to the existing board/code/page.tsx in 
the Agile Scrum Master Next.js app.

### Existing UI patterns to follow (from the codebase):
- Components use Tailwind CSS
- Drawer pattern: TaskDetailDrawer.tsx (uses Sheet from shadcn/ui)
- Loading states: block-loading-overlay.tsx pattern
- Theme: dark/light via theme-provider.tsx, CSS vars from globals.css
- Toast notifications: use existing toast pattern you'll find in the board page
- Agent chat bubble style: AgentBubble.jsx (purple gradient, streaming text)

### What to add to board/code/page.tsx:

1. "Analyze Repository" button in the top action bar
   - Opens a modal/sheet: GitNexusPanel component
   
2. GitNexusPanel component (create as cloud/components/git-nexus-panel.tsx):

   STATE:
   - analyzing: boolean
   - progress: string[]  (SSE log lines)
   - result: NexusAnalysisResult | null
   - selectedTasks: string[]  (task titles user checked)
   
   UI SECTIONS:
   
   A) REPO INPUT (shown when result is null)
      - Text input: GitHub repo URL (pre-filled from project's connected repo if available)
      - Number input: "Analyze last N days" (default: 30)
      - "Analyze" button → calls POST /api/ai/git-nexus/analyze
      - Show sandbox tier badge once analysis starts: "🏗️ Spinning up Small Sandbox (512MB)"
   
   B) PROGRESS STREAM (shown while analyzing)
      - Live log area: renders SSE progress lines as they arrive
      - Each line has an emoji prefix (🔍 / ✅ / ⚠️) from the backend
      - Animated pulsing indicator
   
   C) RESULTS (shown when result arrives)
      - Repo meta bar: language badge, size, commits analyzed, sandbox tier used
      
      - SUGGESTED TASKS section:
        - Each task card shows: title, priority badge (color-coded), story points chip,
          source tag (e.g. "📝 TODO comment"), suggested assignee avatar/name
        - Checkbox to select tasks to import
        - Evidence collapsible: files[] and commits[] that triggered it
      
      - RISK SIGNALS section:
        - Each risk as a compact alert card (severity color-coded)
      
      - DEVELOPER INSIGHTS section:
        - Mini table: name | commits | lines +/- | primary tech
      
      - "Import Selected Tasks to Board" button:
        - POSTs selected tasks to /api/tasks/bulk-create (add this route too)
        - Shows success toast: "✅ 5 tasks imported to backlog"

3. Styling:
   - Panel background: match existing dark card style (bg-card border-border)
   - Priority badges: critical=red-500, high=orange-400, medium=yellow-400, low=blue-400
   - Source tags: subtle gray pill with icon
   - Keep the same font and spacing as TaskDetailDrawer.tsx

Write the full git-nexus-panel.tsx component with all state management.
Use fetch() with ReadableStream for SSE consumption (no external SSE library).
```

---

## PROMPT 6 — Wiring Everything Together (Integration Checklist Prompt)

**Use this prompt as a final verification/wiring step:**

```
You are doing final integration wiring for the GitNexus + E2B feature in 
the Agile Scrum Master app. Review the following and generate any missing glue code.

### Components built so far:
1. nexus.py — git analysis script (runs inside E2B sandbox)
2. sandbox_manager.py — E2B sandbox launcher with dynamic RAM tiers  
3. nexus_mapper.py — maps git data to sprint task schema
4. cloud/app/api/ai/git-nexus/analyze/route.ts — Next.js proxy route
5. cloud/components/git-nexus-panel.tsx — UI panel

### Environment variables to add:

backend/.env:
  E2B_API_KEY=<from e2b dashboard>
  GITHUB_TOKEN=<optional default token>
  DATABASE_URL=<existing postgres url>

cloud/.env.local:
  (no new vars needed — proxies through existing API_GATEWAY_URL)

### FastAPI routes to add to existing API gateway:
The existing gateway (asm-api-gateway.onrender.com) is a Python/FastAPI app.
Add these to it:

```python
# In your existing FastAPI app (api-gateway/main.py or routes/):

from services.git_nexus.sandbox_manager import NexusSandboxManager
from services.git_nexus.nexus_mapper import NexusMapper
from fastapi.responses import StreamingResponse

manager = NexusSandboxManager()

@router.post("/api/v1/git-nexus/analyze")
async def analyze_repo(body: dict, current_user=Depends(get_current_user)):
    repo_url = body.get("repo_url")
    project_id = body.get("project_id")
    
    async def event_stream():
        async for event in manager.run_analysis(
            repo_url=repo_url,
            github_token=body.get("github_token") or os.getenv("GITHUB_TOKEN"),
            branch=body.get("branch", "main"),
            since_days=body.get("since_days", 30)
        ):
            if event["type"] == "progress":
                yield f"data: {json.dumps({'event':'progress','data':event['line']})}\n\n"
            elif event["type"] == "complete":
                # Run mapper
                mapper = NexusMapper(os.getenv("DATABASE_URL"))
                mapped = mapper.map_to_sprint(event["result"], project_id)
                yield f"data: {json.dumps({'event':'complete','data':mapped})}\n\n"
    
    return StreamingResponse(event_stream(), media_type="text/event-stream")

@router.get("/api/v1/git-nexus/status")
async def nexus_status():
    return manager.get_sandbox_status()
```

### Database migration to add (append to cloud/database/init.sql):
```sql
-- GitNexus analysis cache
CREATE TABLE IF NOT EXISTS app.nexus_analyses (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id VARCHAR(255) NOT NULL,
  repo_url TEXT NOT NULL,
  branch VARCHAR(255) DEFAULT 'main',
  since_days INT DEFAULT 30,
  repo_size_kb INT,
  sandbox_tier VARCHAR(50),
  duration_seconds INT,
  result JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nexus_project ON app.nexus_analyses(project_id);
```

### Final checklist — generate code for anything missing:
- [ ] Does nexus_mapper.py read developers from DB by email? (needs DB query)
- [ ] Does the SSE stream properly close on frontend unmount? (AbortController)
- [ ] Is the E2B sandbox properly killed on timeout or error?
- [ ] Is github_token masked in logs? (never log tokens)
- [ ] Do the new tasks imported have status="todo" and are added to the active sprint?

Generate only the missing pieces. Be concise.
```

---

## Quick Reference: File Map

```
Agile_Scrum_Master/
├── cloud/
│   ├── app/api/ai/
│   │   └── git-nexus/
│   │       ├── analyze/route.ts      ← PROMPT 4
│   │       ├── status/route.ts       ← PROMPT 4
│   │       └── tasks/route.ts        ← PROMPT 4
│   ├── components/
│   │   └── git-nexus-panel.tsx       ← PROMPT 5
│   ├── types/
│   │   └── git-nexus.ts             ← PROMPT 4
│   └── database/init.sql            ← PROMPT 6 (append)
│
└── backend/  (api-gateway service)
    └── services/git_nexus/
        ├── nexus.py                  ← PROMPT 1
        ├── sandbox_manager.py        ← PROMPT 2
        └── nexus_mapper.py          ← PROMPT 3
```

---

## Build Order

1. **PROMPT 1** → Build and test `nexus.py` locally first (just needs gitpython)
2. **PROMPT 2** → Wrap it with E2B sandbox (uses your E2B key)
3. **PROMPT 3** → Build the mapper, test with sample nexus JSON
4. **PROMPT 6** (FastAPI wiring) → Add routes to your gateway
5. **PROMPT 4** → Add Next.js proxy routes
6. **PROMPT 5** → Build the UI panel, wire to routes
7. **PROMPT 6** (checklist) → Run final integration verification
