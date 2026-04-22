# 🚀 LiveKit + Deepgram: Quick Start Deployment Guide

**Time to Deploy:** ~15 minutes  
**Complexity:** Medium (ENV vars + Migration script)

---

## ⚡ 5-Minute Setup

### Step 1: Get API Keys

| Service      | Link                         | What You'll Get                              |
| ------------ | ---------------------------- | -------------------------------------------- |
| **LiveKit**  | https://cloud.livekit.io     | API Key, API Secret, Project URL (wss://...) |
| **Deepgram** | https://console.deepgram.com | API Key                                      |
| **Groq**     | Already set (GROQ_API_KEY)   | ✅ Skip (already configured)                 |

### Step 2: Set Environment Variables

**In your deployment platform** (Render, Vercel, Railway, etc.):

```bash
LIVEKIT_API_KEY=<paste-from-cloud.livekit.io>
LIVEKIT_API_SECRET=<paste-from-cloud.livekit.io>
LIVEKIT_URL=<paste-wss-url-from-cloud.livekit.io>
DEEPGRAM_API_KEY=<paste-from-console.deepgram.com>
```

**For local development** (`.env` files):

```bash
# cloud/.env
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_URL=...
DEEPGRAM_API_KEY=...

# cloud/backend/api-gateway/.env
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_URL=...
DEEPGRAM_API_KEY=...
```

### Step 3: Run Migration Script

**SSH into your production server or run via deployment command:**

```bash
cd cloud/backend/api-gateway
node db/migrations/add_meetings_lifecycle.js
```

**Output:**

```
OK org-123
OK org-456
SKIP org-789 empty_connection_string
Done. ok=2 failed=0 skipped=1
```

✅ If successful, `meeting_rooms` table created in all org databases.

### Step 4: Deploy Code

```bash
# Push to main/production branch
git push origin main

# Your CI/CD pipeline will:
# 1. Install deps (already in package.json)
# 2. Build TypeScript
# 3. Deploy to production
```

### Step 5: Verify

**Option A: Run Verification Script**

```bash
cd cloud
node scripts/verify-livekit-deployment.js
```

**Option B: Manual Sanity Checks**

```bash
# Check env vars
echo $LIVEKIT_API_KEY      # Should not be empty
echo $DEEPGRAM_API_KEY     # Should not be empty

# Check database table exists
psql $DATABASE_URL -c "SELECT COUNT(*) FROM meeting_rooms;"

# Check API endpoint responds
curl -X GET http://localhost:4000/api/v1/meetings/health
```

### Step 6: Test End-to-End

1. **Login** to your app
2. **Navigate** to `/meetings`
3. **Click** "Start New Meeting"
4. **Verify:** LiveKit room loads with your video
5. **Speak** into your microphone
6. **Check:** Live transcript appears on the right
7. **Click** "End Meeting"
8. **Verify:** Summary appears + meeting in history below

---

## 🎯 Expected Behavior

### User Flow: Start Meeting

```
User clicks "Start New Meeting"
  ↓
[Backend] Creates room record in DB
[Backend] Generates LiveKit token
[Frontend] Connects to LiveKit with video/audio
[Frontend] Opens Deepgram WebSocket for transcription
[User] Speaks → transcript appears in real-time
```

### User Flow: End Meeting

```
User clicks "End Meeting"
  ↓
[Frontend] Sends transcript to backend
[Backend] Calls Groq API to generate summary
[Backend] Saves summary to DB
[Backend] Broadcasts summary via Socket.IO
[Frontend] Shows summary + past meeting in history
[Frontend] Disconnects from LiveKit
```

### Expected Output

- ✅ Video stream from LiveKit (1-2 sec latency)
- ✅ Live transcript from Deepgram (2-3 sec latency)
- ✅ AI summary from Groq (5-10 sec after end)
- ✅ Meeting in history within 1 sec

---

## ⚠️ Troubleshooting

### "Video won't load"

```
❌ LIVEKIT_URL not set or wrong format
✅ Fix: Set LIVEKIT_URL=wss://project.livekit.cloud (with wss://)
```

### "No transcript appearing"

```
❌ DEEPGRAM_API_KEY expired or invalid
✅ Fix: Regenerate key at https://console.deepgram.com
✅ Check frontend console for WebSocket errors
```

### "Summary not generating"

```
❌ GROQ_API_KEY missing or rate-limited
✅ Fix: Verify GROQ_API_KEY set
✅ Check backend logs for Groq API errors
```

### "Database table not found"

```
❌ Migration script wasn't run
✅ Fix: Run: node db/migrations/add_meetings_lifecycle.js
✅ Verify: psql $DATABASE_URL -c "\dt meeting_rooms;"
```

### "Permission denied" on migration

```
❌ Database user doesn't have CREATE TABLE permission
✅ Fix: Grant permission to DB user or use admin credentials
✅ Contact your database provider support
```

---

## 📊 Performance Expectations

| Metric                    | Expected | Notes                        |
| ------------------------- | -------- | ---------------------------- |
| LiveKit Connection        | < 2 sec  | WebRTC, regional servers     |
| Deepgram First Transcript | 2-3 sec  | Nova-2 model, real-time      |
| Groq Summary Generation   | 5-10 sec | Depends on transcript length |
| UI Refresh (past meeting) | < 1 sec  | Socket.IO broadcast          |

### Optimize If Slow

- **Slow video:** Check network bandwidth, LiveKit server region
- **Slow transcript:** Verify Deepgram API key valid, network latency
- **Slow summary:** Normal; can take 30+ sec for long meetings
  - Consider async UI (show "Generating..." spinner)

---

## 🔍 What Was Deployed

### Backend Changes

- ✅ New meeting room endpoints (`/token`, `/create`, `/transcript`, `/end`)
- ✅ Database table for meeting_rooms
- ✅ Socket.IO org-scoped broadcasting
- ✅ Groq API integration for summaries

### Frontend Changes

- ✅ New components: MeetingRoom, MeetingsList, MeetingSummary
- ✅ New hook: useDeepgramTranscription
- ✅ New page: /meetings (replaces /meetings/daily)
- ✅ Zustand store for state management
- ✅ BFF routes for API proxying

### Database Changes

- ✅ meeting_rooms table (org-scoped)
- ✅ Updated enums: 'daily' → 'livekit'

---

## ✅ Verification Checklist

- [ ] LIVEKIT_API_KEY set and non-empty
- [ ] LIVEKIT_API_SECRET set and non-empty
- [ ] LIVEKIT_URL set in wss:// format
- [ ] DEEPGRAM_API_KEY set and non-empty
- [ ] Migration script ran successfully
- [ ] meeting_rooms table exists in org DBs
- [ ] Code deployed to production
- [ ] Can login and navigate to /meetings
- [ ] Can start a meeting and see video
- [ ] Can speak and see transcript in real-time
- [ ] Can end meeting and see summary
- [ ] Past meeting appears in MeetingsList

---

## 📞 Support

### Check Logs

**Backend logs:**

```bash
# Groq API calls
grep "Groq API" logs/*.txt

# Deepgram connection
grep "Deepgram" logs/*.txt

# Socket.IO broadcasts
grep "emitToOrg" logs/*.txt
```

**Frontend console:**

- Browser DevTools → Console tab
- Look for WebSocket connection status
- Check for API errors (red text)

### Debug Endpoints

```bash
# Check LiveKit config
curl http://localhost:4000/api/v1/meetings/health
# Expected: { apiKeySet: true, urlSet: true }

# List meetings (should return array)
curl http://localhost:4000/api/v1/meetings \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 🎓 What's Next?

After successful deployment:

1. **Monitor** Groq API usage (watch for rate limits)
2. **Gather User Feedback** on transcript quality
3. **Consider Future Features:**
   - Meeting recordings (LiveKit has this)
   - Analytics dashboard
   - Jira issue creation from action items
   - Multi-language support

---

## 📚 Full Documentation

For detailed information, see:

- [`LIVEKIT_DEEPGRAM_MIGRATION.md`](./LIVEKIT_DEEPGRAM_MIGRATION.md) — Comprehensive technical guide
- [`DEPLOYMENT_LIVEKIT_SUMMARY.md`](./DEPLOYMENT_LIVEKIT_SUMMARY.md) — Full implementation details

---

**Status: Ready for Production Deployment ✅**

Questions? Check the comprehensive guide above or review the code in:

- `cloud/backend/api-gateway/src/services/meetings.service.js`
- `cloud/components/meetings/MeetingRoom.tsx`
- `cloud/app/(dashboard)/meetings/page.tsx`
