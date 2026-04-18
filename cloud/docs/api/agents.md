# Agents API

---

### GET /api/agents
List agent definitions.

**Authentication:** Required

---

### POST /api/agents
Create/register an agent.

**Authentication:** Required

---

### GET /api/agents/status
Get aggregate agent status.

**Authentication:** Required

---

### POST /api/agents/run
Run agents now (batch/manual trigger).

**Authentication:** Required

---

### PATCH /api/agents/pause-all
Pause all agents.

**Authentication:** Required

---

### GET /api/agents/decisions
List agent decisions.

**Authentication:** Required

---

### GET /api/agents/actions
List agent action feed.

**Authentication:** Required

---

### GET /api/agents/approvals
List pending/processed approvals.

**Authentication:** Required

---

### POST /api/agents/approvals
Create approval record.

**Authentication:** Required

---

### PATCH /api/agents/approvals/:id/approve
Approve an action.

**Authentication:** Required

---

### PATCH /api/agents/approvals/:id/reject
Reject an action.

**Authentication:** Required

---

### POST /api/agents/:agentName/run
Run one agent immediately.

**Authentication:** Required

---

### PATCH /api/agents/:agentName/pause
Pause one agent.

**Authentication:** Required

---

### PATCH /api/agents/:agentName/status
Update one agent status.

**Authentication:** Required

---

### GET /api/agents/:agentName/stats
Get one agent statistics.

**Authentication:** Required

---

### GET /api/agents/:agentName/config
Get one agent config.

**Authentication:** Required

---

### PATCH /api/agents/:agentName/config
Update one agent config.

**Authentication:** Required

---

### GET /api/agents/:agentName/decisions
Get decisions for one agent.

**Authentication:** Required

---

### DELETE /api/agents/:agentName
Delete/deactivate one agent.

**Authentication:** Required
