# AI API

---

### POST /api/ai/chat
Conversational AI endpoint for sprint/project context.

**Authentication:** Required

---

### POST /api/ai/confirm-action
Confirm an AI-proposed action.

**Authentication:** Required

---

### POST /api/ai/sprint-plan/start
Start sprint planning workflow.

**Authentication:** Required

---

### GET /api/ai/sprint-plan
Fetch sprint plan state/data.

**Authentication:** Required

---

### POST /api/ai/briefing
Generate briefing.

**Authentication:** Required

---

### GET /api/ai/briefing
Fetch briefing context/history.

**Authentication:** Required

---

### GET /api/ai/history
Get AI interaction history.

**Authentication:** Required

---

### POST /api/ai/rebalance
Compute workload rebalance suggestions.

**Authentication:** Required

---

### POST /api/ai/team-rebalance
Run autonomous team rebalance helper.

**Authentication:** Required

---

### POST /api/ai/autopilot
Run autonomous sprint assistant flow.

**Authentication:** Required

---

### POST /api/ai/agentic/sprint-build
Run agentic sprint build.

**Authentication:** Required

---

### POST /api/ai/sprint-planning/scope
Finalize planning scope.

**Authentication:** Required

---

### POST /api/ai/sprint-planning/plan
Generate sprint plan from selected scope.

**Authentication:** Required

---

### POST /api/ai/ticket-enrichment
Enrich ticket content with AI.

**Authentication:** Required

---

### POST /api/ai/standup-summarizer
Summarize standup content.

**Authentication:** Required

---

### POST /api/ai/retrospective-generator
Generate retrospective summary.

**Authentication:** Required

---

### POST /api/ai/risk-narrator
Generate risk narrative.

**Authentication:** Required

---

### POST /api/ai/ml/:path
Proxy to ML operations (training/inference endpoints).

**Authentication:** Required
