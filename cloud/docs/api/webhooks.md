# Webhooks API

---

### POST /api/webhooks/github
Receive GitHub webhook events.

**Authentication:** Signature-based (not user token)

**Headers:**
- X-GitHub-Event
- X-Hub-Signature-256
- X-GitHub-Delivery

**Common events handled:**
- issues (opened, edited, closed)
- pull_request (opened, synchronized, closed)
- push
- workflow_run (deployment/CI insights)

**Side Effects:**
- Records webhook event for observability/retry.
- Emits automation events (for example issue to task, PR transitions).
- Can trigger Inngest functions and assignment/monitoring flows.

---

### POST /api/webhooks/jira/test
Test endpoint for Jira webhook path verification.

**Authentication:** Required (for test call)
