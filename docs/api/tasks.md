# Tasks API

---

### GET /api/tasks
List tasks.

**Authentication:** Required

**Query Params:**
| Field | Type | Required | Description |
|---|---|---|---|
| projectId | string | No | Filter by project |
| sprintId | string | No | Filter by sprint |
| status | string | No | Filter by status |
| assigneeId | string | No | Filter by assignee |
| priority | string | No | Filter by priority |
| search | string | No | Full-text search term |
| page | number | No | Page index |
| limit | number | No | Page size |

---

### POST /api/tasks
Create task.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|---|---|---|---|
| title | string | Yes | Task title |
| description | string | No | Task details |
| priority | string | No | low, medium, high, critical |
| sprintId | string | No | Attach to sprint |
| assigneeId | string | No | Explicit assignee |
| storyPoints | number | No | Effort estimate |
| projectId | string | Yes | Owning project |

**Side Effects:**
- May trigger assignment automation and agent logging.

---

### GET /api/tasks/:taskId
Get task detail.

**Authentication:** Required

---

### PATCH /api/tasks/:taskId
Update task fields.

**Authentication:** Required

---

### DELETE /api/tasks/:taskId
Delete task.

**Authentication:** Required

---

### GET /api/tasks/:taskId/comments
List task comments.

**Authentication:** Required

---

### POST /api/tasks/:taskId/comments
Create task comment.

**Authentication:** Required

---

### GET /api/tasks/:taskId/subtasks
List subtasks.

**Authentication:** Required

---

### POST /api/tasks/:taskId/subtasks
Create subtask.

**Authentication:** Required

---

### POST /api/tasks/:taskId/time-log
Add time log entry.

**Authentication:** Required

---

### PATCH /api/tasks/bulk
Bulk update tasks.

**Authentication:** Required

---

### DELETE /api/tasks/bulk
Bulk delete tasks.

**Authentication:** Required

---

### GET /api/tasks/board/:sprintId
Get board lanes/tasks for sprint.

**Authentication:** Required

---

### PATCH /api/tasks/reorder
Reorder tasks within board/list context.

**Authentication:** Required

---

### PATCH /api/tasks/:taskId/status
Update only task status.

**Authentication:** Required
