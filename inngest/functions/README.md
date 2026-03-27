# Background Agent Functions

This folder defines Inngest functions used for task automation, monitoring, and sprint assistance.

## How It Works Here
- Functions are exported from index.ts.
- app/api/inngest/route.ts registers those functions with Inngest serve().
- Events are emitted by app routes and backend workflows, then processed asynchronously.

## Current Functions
- task-factory.ts:
  - github/issue.opened -> create/deduplicate tasks
  - github/pr.opened -> PR task linkage and enrichment
  - github/push -> follow-up task generation from commits
  - task/created -> auto-assignment and tracking
  - task/updated -> monitoring reactions
  - github/pr.merged -> task completion updates
  - sprint/ending.tomorrow -> cleanup/rollover tasks
- sprint-created-groq-brief.ts:
  - sprint/created -> generate sprint brief via Groq

## Local Testing
1. Run Next.js app and ensure /api/inngest is reachable.
2. Trigger source events via API/webhooks.
3. Inspect function runs in Inngest dev/cloud dashboard.

## Logging and Debugging
- Prefer step.run boundaries around external IO for clear failure scopes.
- Inspect agent action tables and Inngest run logs together for end-to-end traceability.
