# LiveKit + Deepgram Migration Guide

**Last Updated:** 2024  
**Status:** Complete Implementation  
**Replaces:** Daily.co video conferencing

## Overview

This document describes the complete migration from Daily.co to LiveKit (free-tier) with Deepgram real-time transcription for meeting rooms. The system maintains backward compatibility with existing `meeting_sessions` (scheduled meetings) while introducing a new `meeting_rooms` table for ephemeral live meeting rooms.

## Architecture

### Technology Stack

- **Video Conferencing:** LiveKit (free-tier) — WebRTC-based, no vendor lock-in
- **Real-time STT:** Deepgram (nova-2 model) — Streaming WebSocket API
- **Meeting Summaries:** Groq LLaMA 3 (already configured) — Called via AI service endpoint
- **Real-time Events:** Socket.IO with org-scoped rooms — Broadcasting summaries to org members
- **State Management:** Zustand (client-side) — Lightweight meeting state orchestration

### Multi-Tenant Isolation

- JWT auth token includes `orgId` claim
- `orgDbMiddleware` ensures queries scoped to org's tenant DB
- `Socket.IO` org room join/leave enforces subscription isolation
- Database UNIQUE constraint: `UNIQUE(org_id, room_name)` prevents cross-org collisions

---

## Database Schema

### New Table: `meeting_rooms`

Located in **each org's tenant database** (not shared).

```sql
CREATE TABLE meeting_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id TEXT NOT NULL,
  room_name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  transcript TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  status TEXT DEFAULT 'active',        -- active | ended
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  UNIQUE (org_id, room_name)
);

CREATE INDEX idx_meeting_rooms_org ON meeting_rooms(org_id, created_at DESC);
CREATE INDEX idx_meeting_rooms_status ON meeting_rooms(status, created_at DESC);
```

### Updated Enums

In **existing** `meeting_sessions` and `meeting_transcripts` tables:

- `video_provider` enum: Added `'livekit'`, removed `'daily'`
  ```sql
  CHECK (video_provider IN ('none', 'livekit', 'zoom', 'teams'))
  ```
- `source_type` enum: Added `'livekit'`, removed `'daily'`
  ```sql
  CHECK (source_type IN ('manual_upload', 'livekit', 'zoom', 'teams', 'other'))
  ```

### Migration Script

**File:** `backend/api-gateway/db/migrations/add_meetings_lifecycle.js`

Run manually on existing tenant databases:

```bash
cd backend/api-gateway
node db/migrations/add_meetings_lifecycle.js
```

This script:

1. Connects to universal DB to fetch all org connection strings
2. For each org DB, creates `meeting_rooms` table + indexes
3. Updates enums in `meeting_sessions` and `meeting_transcripts`
4. Reports success/skip status per org

---

## Backend Service Layer

### File: `backend/api-gateway/src/services/meetings.service.js`

**Key Methods:**

#### `createMeetingRoomToken(req, payload)`

Generates LiveKit access token for a participant.

```javascript
// Input: { roomName: string, participantName: string }
// Output: { token: string, url: string (LIVEKIT_URL) }
// Validates: roomName (3-180 chars, alphanumeric + ._:-), participantName (1-120 chars)
// Org Isolation: Uses req.user.orgId from JWT
```

#### `createMeetingRoom(req, payload)`

Creates ephemeral meeting room record in tenant DB.

```javascript
// Input: { roomName: string }
// Output: { id, orgId, roomName, createdBy, transcript, summary, status, createdAt, endedAt }
// DB Insert: Enforces UNIQUE(org_id, room_name)
```

#### `listMeetingRooms(req, kind?)`

Lists meeting rooms for org (filtered by status if needed).

```javascript
// Input: Optional `kind=room` query param (for BFF routing)
// Output: Array of meeting_rooms records, org-filtered
// Ordering: created_at DESC (newest first)
```

#### `saveMeetingRoomTranscript(req, payload)`

Saves transcript + generates summary via Groq API.

```javascript
// Input: { roomName: string, transcript: string (1-500k chars) }
// Output: { summary: string }
// Side Effects:
//   1. Updates meeting_rooms.transcript
//   2. Calls Groq API: buildScrumSummaryPrompt(transcript) → LLaMA 3
//   3. Emits via emitToOrg(orgId, 'meeting:summary', {...})
//   4. Updates meeting_rooms.summary
```

**Groq Summary Config:**

- **Model:** llama3-8b-8192 (free tier)
- **Temperature:** 0.2 (deterministic)
- **Max Tokens:** 900
- **Prompt:** Structured output with decisions, risks, action items

#### `endMeetingRoom(req, roomName)`

Marks meeting room as ended.

```javascript
// Input: { roomName: string }
// Output: { ...meeting_room, status: 'ended', endedAt: NOW() }
```

#### `isValidLiveKitUrl(url)`

Validates LiveKit URL format.

```javascript
// Accepts: ws://, wss://, https://
// Example: wss://your-project.livekit.cloud
```

#### `getHealth()`

Returns LiveKit config status (instead of Daily).

```javascript
// Output: { apiKeySet: boolean, urlSet: boolean }
```

---

## Backend Routes & Controllers

### File: `backend/api-gateway/src/routes/meetings.routes.js`

**New Endpoints:**

| Method | Route                   | Handler                       | Purpose                                 |
| ------ | ----------------------- | ----------------------------- | --------------------------------------- |
| POST   | `/token`                | `createMeetingRoomToken()`    | Generate LiveKit access token           |
| POST   | `/create`               | `createMeetingRoom()`         | Create meeting room record              |
| POST   | `/:roomName/transcript` | `saveMeetingRoomTranscript()` | Save + summarize transcript             |
| POST   | `/:roomName/end`        | `endMeetingRoom()`            | Mark room as ended                      |
| GET    | `/`                     | `listMeetings()` (updated)    | List meetings (defaults to `kind=room`) |

**All routes protected by:**

- `authMiddleware` — Validates JWT, extracts user + orgId
- `orgDbMiddleware` — Connects to org's tenant database

### File: `backend/api-gateway/src/controllers/meetings.controller.js`

**Request Validation via Zod:**

- `createMeetingRoomTokenSchema` — roomName + participantName
- `createMeetingRoomSchema` — roomName only
- `meetingRoomParamsSchema` — URL param roomName validation
- `saveMeetingRoomTranscriptSchema` — transcript (1-500k chars)
- `listMeetingsQuerySchema` — Added `kind: z.enum(['session', 'room']).optional()`

---

## Real-time Events (Socket.IO)

### File: `backend/api-gateway/src/realtime/io.js`

**New Functions:**

```javascript
// Generate org room name
orgRoom(orgId) → `org:${orgId}`

// Broadcast to org members
emitToOrg(orgId, event, payload) → io.to(orgRoom(orgId)).emit(event, payload)
```

### Socket.IO Event Handlers

**File:** `backend/api-gateway/src/app.js`

```javascript
// New handlers:
socket.on("org:join", (payload) => {
  socket.join(orgRoom(payload.id));
});

socket.on("org:leave", (payload) => {
  socket.leave(orgRoom(payload.id));
});
```

**Emitted Events:**

- `'meeting:summary'` — Broadcasts when Groq summary is generated
  ```javascript
  { roomName, summary, transcript, generatedAt, status: 'completed' }
  ```

---

## Frontend API Layer (BFF Routes)

### New Routes in `app/api/meetings/`

#### `POST /token`

**File:** `app/api/meetings/token/route.ts`

Proxies to gateway `/api/v1/meetings/token`.

```typescript
// Input: { roomName, participantName }
// Output: { token, url }
```

#### `POST /create`

**File:** `app/api/meetings/create/route.ts`

Proxies to gateway `/api/v1/meetings/create`.

```typescript
// Input: { roomName }
// Output: { id, orgId, roomName, ... }
```

#### `POST /transcript`

**File:** `app/api/meetings/transcript/route.ts`

Proxies to gateway `/api/v1/meetings/{roomName}/transcript`.

```typescript
// Input: { roomName, transcript }
// Output: { summary }
```

#### `POST /end`

**File:** `app/api/meetings/end/route.ts`

Proxies to gateway `/api/v1/meetings/{roomName}/end`.

```typescript
// Input: { roomName }
// Output: { status: 'ended', endedAt }
```

#### `GET /deepgram-token`

**File:** `app/api/meetings/deepgram-token/route.ts`

Exposes Deepgram API key to frontend (scoped to org).

```typescript
// Output: { key: DEEPGRAM_API_KEY }
```

#### `GET /` (Updated)

**File:** `app/api/meetings/route.ts`

Now defaults to `kind=room` when no kind param provided.

```typescript
// If no ?kind param, auto-sets kind=room before proxying
// Proxies to gateway /api/v1/meetings?kind=room
```

---

## Frontend Components & Hooks

### Zustand Store

**File:** `src/store/meetingStore.ts`

State management for meeting lifecycle:

```typescript
interface MeetingStore {
  currentRoom: string | null;
  transcript: string;
  summary: string;
  meetings: MeetingRoomItem[];
  isInMeeting: boolean;

  // Actions
  setRoom(roomName: string): void;
  appendTranscript(text: string): void;
  setSummary(summary: string): void;
  setMeetings(meetings: MeetingRoomItem[]): void;
  endMeeting(): void;
}
```

### useDeepgramTranscription Hook

**File:** `hooks/useDeepgramTranscription.ts`

Real-time speech-to-text via Deepgram WebSocket.

```typescript
// Input: audioTrack (MediaStreamTrack | null)
// Output: { transcript: string, isTranscribing: boolean }

// Workflow:
// 1. Fetch Deepgram token from /api/meetings/deepgram-token
// 2. Open LiveTranscriptionEvents WebSocket
// 3. Record microphone (350ms chunks)
// 4. Send raw audio to Deepgram
// 5. Accumulate final results (interim_results=false)
// 6. Cleanup on unmount or track disconnect
```

**Deepgram Config:**

- **Model:** nova-2 (free tier)
- **Language:** English (auto-detect available)
- **Punctuation:** Enabled
- **Interim Results:** Disabled (only final)

### MeetingRoom Component

**File:** `components/meetings/MeetingRoom.tsx`

Active video room with real-time transcription.

```typescript
// Props: { roomName, participantName, onMeetingEnded callback }

// Workflow:
// 1. Fetch token from /api/meetings/token
// 2. Render LiveKit video component
// 3. TranscriptionBridge sub-component:
//    - Extracts local mic track
//    - Pipes to useDeepgramTranscription
//    - Updates parent transcript state
// 4. Live transcript display (right sidebar)
// 5. "End Meeting" button:
//    - POST /api/meetings/transcript (save + summarize)
//    - POST /api/meetings/end (mark ended)
//    - Disconnect room
//    - Call onMeetingEnded({summary, transcript})

// Bug Fixes:
// - Uses activeRoomRef instead of activeRoom in deps to prevent token reload loop
// - Only setActiveRoom for UI updates; stores actual room in ref
```

### MeetingsList Component

**File:** `components/meetings/MeetingsList.tsx`

Display past meetings history with summary selection.

```typescript
// Props: { refreshSignal }

// Workflow:
// 1. Fetch /api/meetings on mount + when refreshSignal changes
// 2. Display list (status badges, timestamps, duration)
// 3. Click to select room → detail panel on right
// 4. Show MeetingSummary component (summary + scrollable transcript)
// 5. Refresh button re-fetches list
```

### MeetingSummary Component

**File:** `components/meetings/MeetingSummary.tsx`

Display AI summary + full transcript.

```typescript
// Props: { summary, transcript, startedAt, endedAt }

// Displays:
// - Formatted duration (hours + minutes)
// - Copy Summary button (navigator.clipboard)
// - Summary in scrollable container
// - <details> collapsible for full transcript
// - 403 fallback if summary unavailable
```

### Types

**File:** `components/meetings/types.ts`

```typescript
export interface MeetingRoomItem {
  id: string;
  orgId: string;
  roomName: string;
  createdBy: string;
  transcript: string;
  summary: string;
  status: "active" | "ended";
  createdAt: string;
  endedAt?: string;
}
```

---

## Main Meetings Page

**File:** `app/(dashboard)/meetings/page.tsx`

Entry point for all meetings functionality.

### Workflow:

1. **Initialization:**
   - Fetch profile via `/api/auth/me` → get fullName + activeOrgId
   - Subscribe to `useMeetingStore` for state

2. **Hero Section:**
   - "Start New Meeting" button
   - On click: Generate `roomName = sprint-${orgId}-${Date.now()}`
     - POST `/api/meetings/create`
     - On success: `setRoom(roomName)` → `isInMeeting=true`

3. **Conditional Render:**
   - If `isInMeeting`: Show `<MeetingRoom />`
     - `onMeetingEnded` callback:
       - `setSummary(summary)`
       - `appendTranscript(transcript)`
       - `endMeeting()` → `isInMeeting=false`
       - Increment `refreshSignal` → trigger MeetingsList refetch

4. **Below Video:**
   - `<MeetingsList refreshSignal={refreshSignal} />`

### Recent Bug Fixes:

- **Token Reload Loop:** Changed roomName generation from memoized to click-time
- **Active Room Ref:** Use ref instead of state to store LiveKit Room instance, preventing infinite re-renders

---

## Navigation

**File:** `components/sidebar.tsx`

Updated meetings link:

```typescript
// Before: href="/meetings/daily", icon={CalendarDays}
// After:  href="/meetings", icon={Video}
```

---

## Environment Variables

### Frontend (.env / .env.local)

```bash
# LiveKit + Deepgram meetings
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=wss://your-project.livekit.cloud
DEEPGRAM_API_KEY=
```

### Gateway (`backend/api-gateway/.env`)

```bash
# LiveKit + Deepgram meetings
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=wss://your-project.livekit.cloud
DEEPGRAM_API_KEY=

# Groq (already existing)
GROQ_API_KEY=
```

See `.env.example` files for complete templates.

---

## Deployment Checklist

- [ ] **Set Environment Variables**
  - Add LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL, DEEPGRAM_API_KEY
  - Verify GROQ_API_KEY is already set

- [ ] **Run Migration Script** (if not auto-migrated)

  ```bash
  cd backend/api-gateway
  node db/migrations/add_meetings_lifecycle.js
  ```

- [ ] **Verify Database Schema**
  - Check meeting_rooms table exists in each org DB
  - Verify enums updated in meeting_sessions + meeting_transcripts

- [ ] **Install Dependencies**

  ```bash
  # Frontend (already done)
  npm install @livekit/components-react @livekit/components-styles livekit-client @deepgram/sdk

  # Backend (already done)
  npm install livekit-server-sdk @deepgram/sdk
  ```

- [ ] **Test End-to-End Flow**
  1. Login to dashboard
  2. Navigate to `/meetings`
  3. Click "Start New Meeting"
  4. Verify LiveKit room loads with video
  5. Speak into microphone → verify transcript appears
  6. End meeting → verify summary generated + appears in list
  7. Click past meeting → verify summary + transcript display

- [ ] **Monitor Logs**
  - Check backend for Groq API calls (token generation)
  - Check frontend for Deepgram connection errors
  - Monitor Socket.IO org room broadcasts

---

## Backward Compatibility

- ✅ **Existing `meeting_sessions`** table unchanged
  - Scheduled meetings (daily, weekly, retrospective, business) continue to work
  - Can still use old video providers (zoom, teams) or scheduled Daily rooms
  - Provider enum only updated to support 'livekit'; 'daily' can be removed in future

- ✅ **New `meeting_rooms`** table isolated
  - No foreign key dependency on meeting_sessions
  - Can be queried independently or joined via org_id + meeting_type

- ✅ **API Default Behavior**
  - GET `/api/meetings` defaults to `kind=room` for new UI
  - Explicit `?kind=session` available for legacy scheduled meetings

---

## Rollback Plan

If issues arise:

1. **Revert to Daily.co (if still available):**
   - Revert backend provider enum to 'daily'
   - Keep meeting_rooms table (doesn't interfere with sessions)
   - Revert frontend to use Daily SDK

2. **Recover Lost Data:**
   - meeting_rooms table has full transcript + summary history
   - Can export as JSON for archive

3. **Database Recovery:**
   - meeting_rooms table is isolated; can DROP without affecting meeting_sessions
   - Migrations are idempotent; can re-run safely

---

## Known Limitations & Future Work

| Item                            | Status | Notes                                                                    |
| ------------------------------- | ------ | ------------------------------------------------------------------------ |
| Transcript length optimization  | TODO   | Currently stores full text; may need pagination for >100k char meetings  |
| Deepgram connection retry logic | TODO   | Add exponential backoff for WebSocket timeouts                           |
| Multi-language support          | TODO   | Currently hardcoded to English; Deepgram supports auto-detect            |
| Meeting recordings              | TODO   | LiveKit has recording features; not yet integrated                       |
| Advanced analytics              | TODO   | Meeting duration, participant count, transcript quality metrics          |
| Real-time summary subscription  | TODO   | MeetingsList can subscribe to Socket.IO org room events for live updates |

---

## Support & Troubleshooting

### Issue: "No LiveKit URL configured"

- **Cause:** LIVEKIT_URL env var not set or malformed
- **Fix:** Verify URL format is `wss://project.livekit.cloud` (WebSocket secure)

### Issue: "Deepgram connection failed"

- **Cause:** DEEPGRAM_API_KEY missing or expired
- **Fix:** Regenerate key in Deepgram dashboard, update env var

### Issue: "Transcript not saving"

- **Cause:** meeting_rooms table may not exist in org DB
- **Fix:** Run migration script: `node db/migrations/add_meetings_lifecycle.js`

### Issue: "Summary not generating"

- **Cause:** Groq API key missing or rate-limited
- **Fix:** Check GROQ_API_KEY env var, verify rate limits not exceeded

### Issue: "Summary not appearing in real-time"

- **Cause:** Socket.IO org room not subscribed or emitted
- **Fix:** Verify Socket.IO connection + org:join event fired; check backend logs for emitToOrg calls

---

## References

- **LiveKit Docs:** https://docs.livekit.io/
- **Deepgram Docs:** https://developers.deepgram.com/
- **Groq API:** https://console.groq.com/
- **Session-based meetings:** See existing `meeting_sessions` schema for scheduled meeting logic
