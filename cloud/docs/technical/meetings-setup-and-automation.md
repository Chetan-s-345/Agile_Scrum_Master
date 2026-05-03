# Meetings Setup And Automation

This guide describes the full Meetings implementation, required setup, and how transcript + summary + task automation work with Inngest and agentic Scrum Master behavior.

## 1. What is implemented

### UI capabilities

- Meetings lifecycle: create, update, start, complete, archive.
- Meeting type views: Planning, Daily, Review, Retro.
- Attendee assignment and note capture.
- Transcript import and persisted transcript history.
- Dedicated per-meeting detail tabs:
  - Overview
  - Transcript
  - Summary
  - Actions
- Summary tab includes AI Summary, Decisions, Risks, and AI Action Items.

Main UI file:

- cloud/app/(dashboard)/meetings/page.tsx

### Backend capabilities

- Meeting CRUD + lifecycle APIs.
- Transcript upload/list APIs.
- Summary generation API.
- Auto task creation after meeting completion (Claude-based extraction + assignment).
- Meeting completion webhooks from Daily.
- Inngest event dispatch for meeting completion and created-task observability.

Main backend files:

- cloud/backend/api-gateway/src/routes/meetings.routes.js
- cloud/backend/api-gateway/src/controllers/meetings.controller.js
- cloud/backend/api-gateway/src/services/meetings.service.js
- cloud/backend/api-gateway/src/jobs/post-meeting.job.js
- cloud/backend/api-gateway/src/controllers/webhook.controller.js

### Inngest wiring

- Event handlers are registered in:
  - cloud/app/api/inngest/route.ts
- Meeting event contracts are documented in:
  - cloud/inngest/EVENTS.md
- Meeting event observers are implemented in:
  - cloud/inngest/functions/task-factory.ts

## 2. Required environment variables

### Root app (.env)

Required for Next.js and Inngest function runtime:

- API_GATEWAY_URL
- NEXT_PUBLIC_API_URL
- INNGEST_EVENT_KEY
- INNGEST_SIGNING_KEY
- INNGEST_DEV_URL (optional for local)
- DAILY_WEBHOOK_HMAC_SECRET

Template reference:

- cloud/.env.example

### API gateway (.env)

Required for meetings automation and event dispatch:

- DAILY_API_KEY
- DAILY_DOMAIN
- DAILY_WEBHOOK_HMAC_SECRET
- RESEND_API_KEY
- RESEND_FROM_EMAIL
- ANTHROPIC_API_KEY
- INNGEST_DEV_URL (recommended local)
- INNGEST_LOCAL_DEV
- INNGEST_EVENT_URL (optional explicit endpoint)
- INNGEST_EVENT_KEY (cloud fallback)

Template reference:

- cloud/backend/api-gateway/.env.example

## 3. Daily webhook setup

1. Configure Daily to call the app webhook endpoint:

- POST /api/webhooks/daily

2. Ensure signature secret matches in environment:

- DAILY_WEBHOOK_HMAC_SECRET

3. The Next.js webhook route validates the signature and forwards meeting-ended events to API gateway.

Routes:

- cloud/app/api/webhooks/daily/route.ts
- cloud/backend/api-gateway/src/routes/webhook.routes.js
- cloud/backend/api-gateway/src/controllers/webhook.controller.js

## 4. Transcript and summary flow

1. Upload transcript in the Transcript tab.
2. Transcript is stored in meeting_transcripts.
3. If auto summarize is enabled in the UI, summarize runs immediately after upload.
4. Summary fields are persisted into meeting_sessions:

- ai_summary
- ai_decisions
- ai_risks
- ai_action_items

Endpoints:

- GET /api/v1/meetings/:meetingId/transcripts
- POST /api/v1/meetings/:meetingId/transcripts
- POST /api/v1/meetings/:meetingId/summarize

## 5. Agentic Scrum Master task automation

Task automation triggers when a meeting is completed or Daily meeting-ended webhook arrives.

Current automation behavior:

1. Load meeting context (notes, transcript, backlog, team members).
2. Call Claude for action extraction and assignment.
3. Create tasks in tasks table.
4. Create meeting_action_items records.
5. Update developer current sprint load.
6. Notify assignees by email.
7. Emit Inngest events for automation visibility.

Primary files:

- cloud/backend/api-gateway/src/jobs/post-meeting.job.js
- cloud/backend/api-gateway/src/workers/post-meeting.worker.js

## 6. Inngest events used for meetings

Emitted by gateway/job:

- meeting/completed
- meeting/automation.started
- meeting/automation.completed
- meeting/task.created

Observed by Inngest functions:

- meetingCompletedObserved
- meetingTaskCreatedObserved

Docs and registration:

- cloud/inngest/EVENTS.md
- cloud/inngest/functions/index.ts
- cloud/app/api/inngest/route.ts

## 7. Local run sequence

1. Start Inngest dev server (if using local Inngest).
2. Start app stack from cloud workspace.
3. Ensure api-gateway workers are enabled.
4. Create and complete a meeting.
5. Verify:

- transcript entries
- summary fields
- task creation
- Inngest event runs

## 8. Verification commands

Run in this order:

1. From cloud:

- npm run lint

2. From cloud/backend/api-gateway:

- npm test -- --runInBand

Note:

- Current baseline has existing Neon test timeouts in config tests unrelated to meetings implementation.

## 9. Troubleshooting

### Daily webhook accepted but no automation

- Check DAILY_WEBHOOK_HMAC_SECRET in both app and gateway environments.
- Check API gateway logs for dailyWebhook warnings.

### No task assignment created

- Check ANTHROPIC_API_KEY.
- Check worker process is running and Redis is healthy.
- Check post-meeting queue logs.

### No Inngest runs for meetings

- Check INNGEST_DEV_URL or INNGEST_EVENT_URL/INNGEST_EVENT_KEY in gateway env.
- Confirm /api/inngest route is reachable.
- Confirm meeting/completed event was emitted.

### Summary fields are empty

- Ensure transcript text or notes exist before summarize.
- Re-run summarize from Summary or Transcript tab.
