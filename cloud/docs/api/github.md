# GitHub API

---

### GET /api/github/repos
List connected repositories.

**Authentication:** Required

---

### GET /api/github/issues
List repository issues.

**Authentication:** Required

---

### GET /api/github/pull-requests
List repository pull requests.

**Authentication:** Required

---

### GET /api/github/commits
List repository commits.

**Authentication:** Required

---

### GET /api/github/workflows
List workflow runs/status.

**Authentication:** Required

---

### GET /api/github/branches
List branches.

**Authentication:** Required

---

### DELETE /api/github/branches/:repo/:branch
Delete branch.

**Authentication:** Required

---

### GET /api/github/overview
Get summarized GitHub activity dashboard.

**Authentication:** Required

---

### POST /api/github/issues/:id/import
Import an issue into Sprint tasks.

**Authentication:** Required

---

### POST /api/github/prs/:id/link-task
Link pull request to task.

**Authentication:** Required

---

### POST /api/github/ingest
Start ingestion/sync job.

**Authentication:** Required

---

### GET /api/github/ingest/:jobId
Get ingestion job status.

**Authentication:** Required
