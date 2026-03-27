# Sprints API

---

### GET /api/sprints
List sprints.

**Authentication:** Required

**Query Params:**
| Field | Type | Required | Description |
|---|---|---|---|
| projectId | string | No | Filter by project |
| status | string | No | planned, active, completed, archived |

---

### POST /api/sprints
Create sprint.

**Authentication:** Required

---

### GET /api/sprints/:sprintId
Get sprint detail.

**Authentication:** Required

---

### PATCH /api/sprints/:sprintId
Update sprint metadata.

**Authentication:** Required

---

### DELETE /api/sprints/:sprintId
Delete sprint.

**Authentication:** Required

---

### PATCH /api/sprints/:sprintId/start
Start sprint.

**Authentication:** Required

---

### PATCH /api/sprints/:sprintId/complete
Complete sprint.

**Authentication:** Required

---

### PATCH /api/sprints/:sprintId/archive
Archive sprint.

**Authentication:** Required

---

### GET /api/sprints/:sprintId/burndown
Get sprint burndown metrics.

**Authentication:** Required

---

### GET /api/sprints/:sprintId/risk
Get sprint risk status.

**Authentication:** Required

---

### POST /api/sprints/:sprintId/plan
Run sprint planning operation.

**Authentication:** Required

---

### POST /api/sprints/:sprintId/agentic-build
Run agentic sprint build workflow.

**Authentication:** Required
