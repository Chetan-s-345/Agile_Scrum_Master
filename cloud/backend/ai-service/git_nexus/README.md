# GitNexus - GitHub Repository Analysis Engine

Enterprise-grade GitHub repository analysis with E2B sandbox isolation and 5-point analysis framework.

## 📋 Overview

GitNexus analyzes GitHub repositories to automatically generate sprint tasks, identify risks, suggest developers, and provide intelligence for sprint planning.

**Key Features:**

- 🔍 Commit history analysis (types, authors, trends)
- 🔥 File change heatmap with domain classification
- 📝 Open work detection (TODO/FIXME/HACK/BUG comments)
- 📦 Dependency drift detection (pre-release, outdated versions)
- 🌿 Stale branch detection (unmerged, old)
- 🚀 E2B sandbox isolation with dynamic resource allocation (512MB-4GB)
- 💾 PostgreSQL persistence (nexus_analyses table)
- 🔄 SSE streaming for real-time progress

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Routes                           │
│  POST /api/v1/git-nexus/analyze                             │
│  GET  /api/v1/git-nexus/status                              │
│  GET  /api/v1/git-nexus/tasks?projectId=...                │
│  POST /api/v1/git-nexus/import-tasks                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
        ┌──────────────────────────────────┐
        │  NexusSandboxManager             │
        │  (Async orchestrator)            │
        │                                  │
        │  - GitHub API size estimation   │
        │  - Resource tier selection      │
        │  - E2B sandbox lifecycle        │
        │  - Progress streaming           │
        └──────────────────┬───────────────┘
                           │
                    ┌──────┴───────────┐
                    ↓                  ↓
        ┌──────────────────────┐  ┌─────────────────┐
        │ E2B Sandbox          │  │ PostgreSQL      │
        │ (agile-gitnexus-)    │  │ (app schema)    │
        │  - gitpython         │  │ - nexus_        │
        │  - git, curl, wget   │  │   analyses      │
        │  - analyzer.py       │  │ - tasks         │
        └──────────┬───────────┘  │ - developers    │
                   │              └─────────────────┘
                   ↓
        ┌──────────────────────┐
        │ GitNexusAnalyzer     │
        │ (Inside sandbox)     │
        │                      │
        │ - clone_repo()       │
        │ - analyze_commits()  │
        │ - analyze_file_...() │
        │ - detect_open...()   │
        │ - analyze_depende..()│
        │ - detect_stale...()  │
        │ - run_analysis()     │
        └──────────┬───────────┘
                   │
                   ↓
        ┌──────────────────────┐
        │ NexusMapper          │
        │ (Transform & match)  │
        │                      │
        │ - match_developers() │
        │ - deduplicate_tasks()│
        │ - enrich_descriptions│
        │ - build_sprint_...() │
        └──────────────────────┘
```

## 📁 Files

```
git_nexus/
├── __init__.py                          # Module exports
├── analyzer.py                          # Core analysis engine (600+ lines)
│   ├── GitNexusAnalyzer class
│   ├── 6 analysis methods
│   ├── CLI entry point (--repo-url, --token, --branch, --since-days)
│   └── JSON output schema
├── sandbox.py                           # E2B lifecycle manager (300+ lines)
│   ├── NexusSandboxManager class
│   ├── Resource tier selection (4 tiers: 512MB-4GB)
│   ├── GitHub API size estimation
│   ├── Async sandbox lifecycle with progress streaming
│   └── Error handling (404, 403, rate limit, >2GB)
├── mapper.py                            # Task mapper (350+ lines)
│   ├── NexusMapper class
│   ├── Developer matching (by email, capacity, tech stack)
│   ├── Task deduplication (80% fuzzy matching)
│   ├── Sprint context enrichment
│   └── Database integration (asyncpg)
├── e2b/
│   ├── __init__.py
│   ├── template.py                      # E2B template definitions
│   └── (generated) analyze.py, setup.sh, Dockerfile
├── routes/
│   ├── __init__.py
│   └── api.py                           # FastAPI routes (4 endpoints)
├── tests/
│   ├── __init__.py
│   ├── test_analyzer.py
│   ├── test_sandbox.py
│   ├── test_mapper.py
│   └── test_routes.py
├── STRUCTURE.md                         # Module reference
├── README.md                            # This file
└── __pycache__/
```

## 🚀 Quick Start

### 1. Prerequisites

```bash
# Python 3.11+
python3 --version

# PostgreSQL with Neon (optional for persistence)
export DATABASE_URL=postgresql://user:pass@host/db

# GitHub token (required for API calls)
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# E2B API key (required for sandbox)
export E2B_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
```

### 2. Install Dependencies

```bash
cd cloud/backend/ai-service
python -m pip install -r requirements.txt
# OR specific:
python -m pip install gitpython httpx e2b-code-interpreter asyncpg pydantic
```

### 3. Push E2B Template

```bash
cd templates/git-nexus-runtime

# Validate files
python3 deployer.py --validate

# Build locally
python3 deployer.py --build-only

# Push to E2B (requires E2B_API_KEY)
python3 deployer.py --push

# Verify
python3 deployer.py --verify
```

### 4. Wire Router into FastAPI

In `cloud/backend/ai-service/app/main.py`:

```python
from git_nexus.routes import router as git_nexus_router

# ... setup code ...

app.include_router(git_nexus_router, prefix="/api/v1", tags=["gitnexus"])
```

### 5. Test Endpoint

```bash
# Start server
cd cloud/backend/ai-service
uvicorn app.main:app --reload --port 8000

# In another terminal:
curl -X POST http://localhost:8000/api/v1/git-nexus/analyze \
  -H 'Content-Type: application/json' \
  -d '{
    "repo_url": "https://github.com/torvalds/linux",
    "project_id": "project-123",
    "branch": "master",
    "since_days": 30
  }'
```

Output (SSE stream):

```
data: {"type":"progress","line":"🏗️ Creating E2B sandbox..."}
data: {"type":"progress","line":"📝 Uploading analyzer module..."}
data: {"type":"progress","line":"🔍 Cloning repository..."}
data: {"type":"progress","line":"📊 Running analysis..."}
data: {"type":"complete","result":{"config_used":{...},"duration_seconds":145,"result":{...}}}
```

## 📊 API Reference

### POST /api/v1/git-nexus/analyze

Analyze a GitHub repository with SSE streaming.

**Request:**

```json
{
  "repo_url": "https://github.com/owner/repo",
  "project_id": "project-123",
  "branch": "main",
  "since_days": 30
}
```

**Response (SSE):**

```
data: {"type":"progress","line":"..."}
data: {"type":"complete","result":{...}}
```

**Result Schema:**

```json
{
  "repo_meta": {
    "url": "...",
    "branch": "main",
    "total_commits_analyzed": 150,
    "analysis_window_days": 30,
    "repo_size_kb": 5000,
    "primary_language": "Python",
    "languages_detected": ["Python", "JavaScript"]
  },
  "file_heatmap": {
    "total_files_changed": 45,
    "hottest_files": [
      { "file": "src/core/analyzer.py", "changes": 12, "domain": "backend" }
    ],
    "domain_breakdown": {
      "backend": 20,
      "frontend": 15,
      "database": 5,
      "infra": 3,
      "tests": 2
    }
  },
  "dependency_drift": [
    {
      "file": "package.json",
      "package": "express",
      "current": "4.18.0-beta",
      "concern": "pre-release version detected",
      "type": "pre-release"
    }
  ],
  "suggested_tasks": [
    {
      "title": "Refactor authentication module",
      "description": "...",
      "tech_tags": ["Python", "asyncio"],
      "story_points": 5,
      "priority": "high",
      "source": "file-heatmap",
      "evidence": ["auth.py: 15 changes"],
      "suggested_assignee_email": "dev@example.com"
    }
  ],
  "developer_insights": [
    {
      "email": "alice@example.com",
      "commits": 32,
      "lines_added": 2500,
      "lines_deleted": 1200,
      "primary_files": ["src/core/*.py"],
      "primary_tech": ["Python", "SQL"],
      "suggested_capacity_points": 8
    }
  ],
  "risk_signals": [
    {
      "type": "stale-branch",
      "severity": "medium",
      "detail": "Branch 'feature/old-work' is 45 days old",
      "files": []
    }
  ]
}
```

### GET /api/v1/git-nexus/status

Get current sandbox status.

**Response:**

```json
{
  "active_sandboxes": 0,
  "total_analyses_today": 5,
  "avg_duration_seconds": 142,
  "last_error": null
}
```

### GET /api/v1/git-nexus/tasks?projectId=...

Get cached tasks from analysis.

**Response:**

```json
{
  "tasks": [{ "id": "task-123", "title": "...", "story_points": 5 }],
  "cached_at": "2024-01-15T10:30:00Z"
}
```

### POST /api/v1/git-nexus/import-tasks

Import suggested tasks into project.

**Request:**

```json
{
  "project_id": "project-123",
  "tasks": [{ "title": "...", "story_points": 5, "priority": "high" }]
}
```

**Response:**

```json
{
  "imported": 10,
  "failed": 2,
  "errors": [{ "task": "...", "reason": "Duplicate found" }]
}
```

## 🔧 Configuration

### Environment Variables

```bash
# E2B Configuration
E2B_API_KEY=sk_xxxxxxxxxxxx              # E2B API key (required)
E2B_TEMPLATE=agile-gitnexus-runtime      # Canonical E2B runtime template

# GitHub
GITHUB_TOKEN=ghp_xxxxxxxxxxxx            # Personal access token (required)

# Database
DATABASE_URL=postgresql://...            # PostgreSQL connection (optional)

# Logging
LOG_LEVEL=INFO                           # INFO|DEBUG|WARNING|ERROR
```

### Resource Tiers

GitNexus automatically selects resource tier based on repository size:

| Tier   | Size      | RAM   | CPU | Timeout | Cost  |
| ------ | --------- | ----- | --- | ------- | ----- |
| tiny   | <10MB     | 512MB | 0.5 | 2m      | $0.01 |
| small  | 10-100MB  | 1GB   | 1.0 | 4m      | $0.02 |
| medium | 100-500MB | 2GB   | 2.0 | 8m      | $0.04 |
| large  | >500MB    | 4GB   | 4.0 | 15m     | $0.08 |

## 📈 Performance

- **Size estimation:** <100ms (GitHub API call)
- **Small repo (10MB):** 60-90s
- **Medium repo (100MB):** 120-180s
- **Large repo (500MB):** 300-600s
- **E2B overhead:** ~15s (sandbox creation + upload)

## 🛡️ Error Handling

| Error                     | Cause                              | Solution                                 |
| ------------------------- | ---------------------------------- | ---------------------------------------- |
| 404 Repository not found  | Invalid URL or not accessible      | Verify repo URL, check permissions       |
| 403 Permission denied     | GitHub rate limit or access denied | Check GITHUB_TOKEN, wait 1hr             |
| >2GB Repository too large | E2B limit exceeded                 | Analyze subset or split repos            |
| Timeout                   | Analysis took too long             | Use smaller since_days or larger tier    |
| No valid JSON             | Analyzer crashed                   | Check logs, verify git/python in sandbox |

## 🧪 Testing

```bash
# Unit tests
pytest git_nexus/tests -v

# Integration test (requires E2B_API_KEY)
pytest git_nexus/tests/test_integration.py -v --e2b

# Manual analyzer test
cd git_nexus
python3 analyzer.py \
  --repo-url https://github.com/torvalds/linux \
  --branch master \
  --since-days 7
```

## 📚 References

- [E2B Documentation](https://e2b.dev/docs)
- [GitPython API](https://gitpython.readthedocs.io/)
- [FastAPI SSE Guide](https://fastapi.tiangolo.com/advanced/sse/)
- [Database Schema](../../../docs/DEPLOYMENT_AND_TROUBLESHOOTING.md)

## 🤝 Contributing

1. Update analyzer.py for new analyses
2. Add tests in tests/ folder
3. Update JSON schema in STRUCTURE.md
4. Rebuild E2B template if dependencies change
5. Push template to E2B registry

## 📝 License

Part of Agile Scrum Master. See [LICENSE](../../../LICENSE).
