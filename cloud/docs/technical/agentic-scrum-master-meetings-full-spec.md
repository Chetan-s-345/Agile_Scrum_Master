# Agentic Scrum Master Meetings: Full Architecture and Implementation Guide

## 1. Scope and Goals

This document describes the complete meeting system used by the Agentic Scrum Master experience, including:

- Full-screen Google-Meet-like live meetings.
- Shareable join links and room ID join flow.
- Admin-only meeting creation/start/end controls.
- Two meeting modes:
  - `normal`
  - `sprint_planner`
- Normal meeting categories:
  - `daily_sprint`
  - `weekly_sprint`
  - `backlogs`
  - `business_meeting`
  - `retrospective`
- Daily/scheduled meetings.
- Live room chat redesign.
- Transcript + summary + individual summaries after meeting end.
- Dedicated dynamic page per meeting room ID.
- Function mapping, DB schema, and Inngest events in one place.

## 2. High-Level Architecture

### Frontend (Next.js App Router)

- Main hub page: `app/(dashboard)/meetings/page.tsx`
- Dynamic room detail page: `app/(dashboard)/meetings/rooms/[roomId]/page.tsx`
- Live room UI: `components/meetings/MeetingRoom.tsx`
- Chat panel: `components/meetings/MeetingChatPanel.tsx`
- Historical room list: `components/meetings/MeetingsList.tsx`
- Client store: `src/store/meetingStore.ts`

### BFF Layer (Next.js API routes)

- Proxies frontend requests to API Gateway under `/api/v1/meetings/*`.
- Preserves auth token from cookies.
- New BFF routes added for room chat and room detail by ID.

### Backend (Express API Gateway)

- Routes: `backend/api-gateway/src/routes/meetings.routes.js`
- Controller: `backend/api-gateway/src/controllers/meetings.controller.js`
- Service logic: `backend/api-gateway/src/services/meetings.service.js`
- Validation schemas: `backend/api-gateway/src/validators/meetings.schemas.js`
- Post-meeting job: `backend/api-gateway/src/jobs/post-meeting.job.js`

### Realtime/AI Integrations

- Live video/audio: LiveKit.
- Live speech-to-text: Deepgram.
- Summary generation: Groq.
- Event automation/observability: Inngest.

## 3. Role and Permission Model

### Enforced Policy

Only organization `owner` or `admin` can:

- Create a room meeting (`POST /api/v1/meetings/create`)
- Create/schedule a session meeting (`POST /api/v1/meetings`)
- Start a scheduled session (`POST /api/v1/meetings/:meetingId/start`)
- End a room meeting (`POST /api/v1/meetings/:roomName/end`)
- Mark session status to `completed`/`archived` via update

Non-admin users can:

- Join meetings by room ID or share link.
- View live meeting UI, transcript, summaries, detail pages.
- Participate in chat.

### Enforcement Layers

- Backend hard enforcement in `meetings.service.js` via role checks (`req.user.role`).
- Frontend UX gating in meetings page and live room component:
  - Non-admin users do not get create/start/end controls.
  - They still get join/view controls.

## 4. Core User Flows

### 4.1 Create and Start Live Room (Admin)

1. Admin configures meeting mode/category/title/description.
2. Frontend calls `POST /api/meetings/create` (BFF).
3. Gateway creates or reactivates `meeting_rooms` row.
4. Frontend enters live room with returned `roomName`.
5. LiveKit token is requested from `/api/meetings/token`.

### 4.2 Join by Room ID or Share Link (All members)

1. User pastes room ID or clicks link: `/meetings?room=<roomName>&autojoin=1`.
2. Frontend auto-joins by requesting room token.
3. Participant join is recorded in `meeting_room_participants`.

### 4.3 Transcript and End Meeting (Admin)

1. During meeting, transcript accumulates from Deepgram on client.
2. Admin clicks End Meeting.
3. Frontend saves transcript via `POST /api/meetings/transcript`.
4. Backend generates team summary (Groq) and stores in `meeting_rooms.summary`.
5. Backend ends room via `POST /api/meetings/end`.
6. Backend generates/upserts individual summaries for all participants.

### 4.4 Scheduled Meeting Session (Admin)

1. Admin schedules via `POST /api/meetings` with `type`, `scheduledStart`, metadata.
2. Scheduled list appears on meetings hub.
3. Admin starts scheduled session via `POST /api/meetings/:meetingId/start`.
4. Join URL is generated/updated if provider is LiveKit.

### 4.5 Room Detail Page (All members)

- URL: `/meetings/rooms/[roomId]`
- Displays:
  - Title
  - Description
  - Meeting mode/category/status
  - Scheduled timestamp (if any)
  - Team summary
  - My individual summary
  - Transcript
  - Participants
  - All individual summaries
  - Metadata (created/ended timestamps, room name)

## 5. API and Function Map

### 5.1 Room-oriented Endpoints

- `POST /api/v1/meetings/token`
  - Function: `createMeetingRoomToken`
  - Purpose: LiveKit token for a room.

- `POST /api/v1/meetings/create`
  - Function: `createMeetingRoom`
  - Admin only.
  - Creates or reactivates room with metadata.

- `GET /api/v1/meetings/rooms/:roomId`
  - Function: `getMeetingRoomById`
  - Full room detail for dynamic page.

- `POST /api/v1/meetings/:roomName/participants/join`
  - Function: `joinMeetingRoomParticipant`

- `POST /api/v1/meetings/:roomName/participants/leave`
  - Function: `leaveMeetingRoomParticipant`

- `GET /api/v1/meetings/:roomName/participants`
  - Function: `listMeetingRoomParticipants`

- `PATCH /api/v1/meetings/:roomName/participants/:participantId`
  - Function: `updateMeetingRoomParticipant`

- `DELETE /api/v1/meetings/:roomName/participants/:participantId`
  - Function: `removeMeetingRoomParticipant`

- `POST /api/v1/meetings/:roomName/transcript`
  - Function: `saveMeetingRoomTranscript`
  - Saves transcript and generates team summary.

- `GET /api/v1/meetings/:roomName/messages`
  - Function: `listMeetingRoomMessages`

- `POST /api/v1/meetings/:roomName/messages`
  - Function: `createMeetingRoomMessage`

- `POST /api/v1/meetings/:roomName/summaries/individual`
  - Function: `generateIndividualMeetingRoomSummary`

- `GET /api/v1/meetings/:roomName/summaries/individual`
  - Function: `listMeetingRoomIndividualSummaries`

- `POST /api/v1/meetings/:roomName/end`
  - Function: `endMeetingRoom`
  - Admin only.

### 5.2 Session-oriented Endpoints

- `GET /api/v1/meetings`
  - Function: `listMeetings` (session list) or `listMeetingRooms` when `kind=room`.

- `POST /api/v1/meetings`
  - Function: `create`
  - Admin only.

- `GET /api/v1/meetings/:meetingId`
  - Function: `getById`

- `PATCH|PUT /api/v1/meetings/:meetingId`
  - Function: `update`
  - Status to `completed`/`archived` requires admin.

- `DELETE /api/v1/meetings/:meetingId`
  - Function: `delete`

- `POST /api/v1/meetings/:meetingId/start`
  - Function: `startMeeting`
  - Admin only.

- `POST /api/v1/meetings/:meetingId/attendees`
  - Function: `setAttendees`

- `GET|POST /api/v1/meetings/:meetingId/notes`
  - Functions: `listNotes`, `addNote`

- `POST /api/v1/meetings/:meetingId/description`
  - Function: `updateDescription`

- `GET|POST /api/v1/meetings/:meetingId/transcripts`
  - Functions: `listTranscripts`, `uploadTranscript`

- `POST /api/v1/meetings/:meetingId/summarize`
  - Function: `summarizeMeeting`

## 6. Database Design

## 6.1 Room Tables

### `meeting_rooms`

Key columns:

- `id` UUID PK
- `org_id` TEXT
- `room_name` TEXT (unique per org)
- `created_by` TEXT
- `meeting_kind` TEXT default `normal`
- `normal_category` TEXT default `daily_sprint`
- `title` TEXT
- `description` TEXT
- `scheduled_for` TIMESTAMPTZ
- `transcript` TEXT
- `summary` TEXT
- `status` TEXT (active/ended)
- `created_at`, `ended_at`

Constraints/indexes:

- Unique: `(org_id, room_name)`
- Indexes: org/status time-series indexes

### `meeting_room_participants`

- Tracks join/leave lifecycle and role per participant in room.
- Unique on `(room_id, user_id)`.
- Indexed by room and by `(org_id, user_id)`.

### `meeting_room_individual_summaries`

- Stores per-user generated summary/action-items for each room.
- Unique on `(room_id, user_id)`.

### `meeting_room_messages`

- Chat messages per room.
- Ordered by `created_at` for timeline render.

## 6.2 Session Tables

### `meeting_sessions`

- Scheduled and managed meetings with lifecycle statuses.
- Supports provider metadata and AI action item payloads.

### Related tables

- `meeting_attendees`
- `meeting_notes`
- `meeting_action_items`
- `meeting_transcripts`

## 6.3 Migration and Bootstrap Files

- Tenant migration script:
  - `backend/api-gateway/db/migrations/add_meetings_lifecycle.js`
- Tenant schema bootstrap:
  - `backend/api-gateway/init.sql`
- Shared app schema bootstrap:
  - `database/init.sql`

## 7. Inngest Events (Meeting Domain)

### Emitted Events

- `meeting/completed`
  - Emitted when session transitions to completed and from Daily webhook.
  - Payload includes org/meeting/project/sprint metadata and source.

- `meeting/automation.started`
  - Emitted by post-meeting automation job when task extraction starts.

- `meeting/task.created`
  - Emitted per auto-generated task created from meeting outputs.

- `meeting/automation.completed`
  - Emitted when post-meeting automation finishes.

### Consumers/Observers

- In `inngest/functions/task-factory.ts`:
  - `meetingCompletedObserved` listens to `meeting/completed`
  - `meetingTaskCreatedObserved` listens to `meeting/task.created`

### Side Effects

- Meeting observability action trail.
- Traceable audit of meeting-generated tasks.
- Integrates meeting outcomes into broader agentic Scrum workflows.

## 8. Error Contract and Validation

- Backend validation uses Zod schemas.
- Error shape used by API paths:

```json
{
  "error": "string",
  "code": 400,
  "detail": "string"
}
```

- Raw stack traces are not returned to clients.

## 9. Meeting Type and Category Mapping

### Meeting kinds

- `normal`
- `sprint_planner`

### Normal categories

- `daily_sprint`
- `weekly_sprint`
- `backlogs`
- `business_meeting`
- `retrospective`

### Session type mapping (scheduling)

- `sprint_planner` -> `planning`
- `daily_sprint` -> `daily`
- `weekly_sprint` -> `weekly`
- `backlogs` -> `planning`
- `business_meeting` -> `business`
- `retrospective` -> `retrospective`

## 10. UI Behavior Summary

- Full-screen toggle in live room.
- Share link copy + room ID copy.
- Join by room ID with optional autojoin query.
- Sidebar tabs: Participants, Transcript, Chat.
- End Meeting button visible only to admins.
- Scheduled meetings section with start controls restricted to admins.

## 11. Operational Notes

- LiveKit URL and credentials must be configured.
- Deepgram keys required for live transcription.
- Groq key required for summary generation.
- Inngest should be configured for event-driven observability and post-meeting automation.

## 12. Current Compliance with Requested Capabilities

Implemented:

- Full-screen live meeting experience.
- Shareable link + room ID join.
- Participant join/view workflow.
- Transcript, team summary, individual summaries after meeting end.
- Dynamic detail page for each room ID.
- Scheduled meetings flow.
- Redesigned chat panel.
- Two meeting kinds and normal category options.
- Admin-only create/start/end enforcement.

This file is the single source of truth for architecture, database, function map, and Inngest events for the meeting subsystem.
