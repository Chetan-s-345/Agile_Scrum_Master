# Projects API

---

### GET /api/projects
List projects.

**Authentication:** Required

---

### POST /api/projects
Create project.

**Authentication:** Required

---

### GET /api/projects/:projectId
Get project detail.

**Authentication:** Required

---

### PATCH /api/projects/:projectId
Update project.

**Authentication:** Required

---

### DELETE /api/projects/:projectId
Delete project.

**Authentication:** Required

---

### GET /api/projects/:projectId/backlog
List project backlog.

**Authentication:** Required

---

### GET /api/projects/:projectId/automation-policy
Read automation policy for project.

**Authentication:** Required

---

### PATCH /api/projects/:projectId/automation-policy
Update automation policy for project.

**Authentication:** Required

**Request Body fields:**
- createFromIssue
- createFromPr
- autoAssign
- monitoringEnabled
- guardedMode
