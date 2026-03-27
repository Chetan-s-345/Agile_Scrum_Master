# Assignment API

---

### POST /api/assignment/assign
Assign one task automatically.

**Authentication:** Required

---

### POST /api/assignment/assign-explicit
Assign one task to explicit developer.

**Authentication:** Required

---

### POST /api/assignment/assign-bulk
Assign multiple tasks.

**Authentication:** Required

---

### POST /api/assignment/reassign
Reassign task.

**Authentication:** Required

---

### GET /api/assignment/suggest/:taskId
Get suggested assignees and scoring for a task.

**Authentication:** Required

---

### GET /api/assignment/failures
List assignment failures and reasons.

**Authentication:** Required

---

### GET /api/assignment/log
List assignment history log.

**Authentication:** Required

**Query Params:**
- projectId
- page
- limit
