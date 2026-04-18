# Backend Deployment & Task Description Fix - Troubleshooting Guide

## Overview

This document covers the recent fixes implemented to address two critical issues:

1. **Unreachable `/api/v1/agents` endpoint** - Enhanced error diagnostics and middleware validation
2. **Missing context in auto-created task descriptions** - LLM-based description generation

---

## Issue 1: Agents Route Not Reachable

### Root Cause Analysis

The `/api/v1/agents` endpoint exists but is **not reachable** due to:

1. **Missing or invalid JWT token** - Auth middleware denies request
2. **Missing `orgId` in JWT** - orgDb middleware fails to resolve org database
3. **Organization database not provisioned** - Database connection string not found
4. **Team member not registered** - User exists but not linked in org database
5. **Deployment mismatch** - Backend is not deployed with the latest agent routes

### Fixes Applied

#### ✅ Enhanced Agents Route Error Handling

**File**: `backend/api-gateway/src/routes/agents.routes.js`

Added explicit validation with diagnostic messages:

```javascript
if (!req.orgDb) {
  return jsonError(
    res,
    503,
    "Service Unavailable",
    "Check: (1) auth middleware passed, (2) org database provisioned, (3) UNIVERSAL_DATABASE_URL env set",
  );
}
```

#### ✅ Improved orgDb Middleware Diagnostics

**File**: `backend/api-gateway/src/middleware/orgDb.js`

Added detailed error handling for each step:

- Validates `orgId` in JWT token
- Checks org pool availability
- Validates tenant schema
- Ensures team member registration
- Provides specific error codes and guidance

### Deployment Checklist

Before deploying the backend, ensure:

```bash
# 1. Environment variables are set
API_GATEWAY_URL=https://your-deployment.com
UNIVERSAL_DATABASE_URL=postgresql://...
JWT_SECRET=your_secret_min_32_chars
DATABASE_URL=postgresql://...

# 2. Redis is running (if ENABLE_WORKERS=true)
REDIS_URL=redis://...

# 3. Groq API key is available for task descriptions
GROQ_API_KEY=gsk_...

# 4. LLM model is configured
GROQ_MODEL=llama-3.1-8b-instant  # Optional, has default

# 5. Inngest is configured
INNGEST_EVENT_KEY=evt_...
INNGEST_SIGNING_KEY=signkey_...

# 6. GitHub integration (optional)
GITHUB_WEBHOOK_SECRET=whsec_...
GITHUB_TASK_PREFIX=SCRUM  # Optional
```

### Testing the Agents Route

After deployment, test with:

```bash
# Get auth token from Next.js session
TOKEN=$(curl -X POST http://localhost:3000/api/auth/callback/credentials \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"..."}')

# Test agents endpoint
curl -X GET http://localhost:4000/api/v1/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

**Expected response** (success):

```json
{
  "agents": [
    { "id": "sprint-autopilot", "name": "Sprint Autopilot", "status": "active", ... },
    { "id": "developer-intelligence", "name": "Developer Intelligence", "status": "active", ... },
    ...
  ]
}
```

**If error 503**: Check `orgId` in token and database connection
**If error 401**: Check JWT token validity

---

## Issue 2: Task Descriptions Lacking Context

### Root Cause Analysis

Auto-created tasks (from GitHub issues/PRs/commits) had minimal descriptions:

- Just raw GitHub body (often empty)
- No context, requirements, or technical details
- No structured format for task management
- Missing tech stack and priority information

### Fixes Applied

#### ✅ LLM-Based Description Generation

**File**: `inngest/functions/task-factory.ts`

Added three new functions:

1. **`generateTaskDescription()`** - Calls Groq LLM to generate rich descriptions
2. **`buildContextForLLM()`** - Constructs context prompt including:
   - GitHub issue/PR number
   - Raw description
   - Tech tags (inferred from title/body)
   - Priority classification
   - Similar existing tasks (for deduplication)
3. **`buildBasicDescription()`** - Fallback when LLM unavailable

#### ✅ Updated GitHub Event Handlers

All three event handlers now use LLM:

1. **`githubIssueToTask`** - Generates description for GitHub issues
2. **`prToTask`** - Generates description for GitHub pull requests
3. **`githubPushToTask`** - Generates description for commit-based tasks

### Generated Description Format

**Example output** (from LLM):

```
This task addresses the need to implement robust error handling for the API gateway.
The issue indicates that unhandled exceptions in middleware are causing silent failures.

Technical Requirements:
- Middleware error catching with try-catch
- Logging to error tracking service
- HTTP error responses with proper status codes
- Client-friendly error messages without stack traces

Tech stack: backend, devops
Priority: high
Related tasks: [task] Error handling in auth middleware
```

### Configuration

The LLM description generation uses **Groq LLaMA 3.1**:

```env
# Required for task descriptions
GROQ_API_KEY=gsk_...

# Optional (has defaults)
GROQ_MODEL=llama-3.1-8b-instant
```

**Fallback behavior**: If `GROQ_API_KEY` is not set or LLM fails, descriptions fall back to the basic format (raw GitHub body + tech tags + related tasks).

### Task Creation Flow (Updated)

```
GitHub Push → Webhook → /api/github/webhook
    ↓
Inngest Event Emitted (github/issue.opened | github/pr.opened | github/push)
    ↓
Task Factory Function Triggered
    ↓
1. Check policy (createFromIssue/createFromPr)
2. Search for similar tasks (RAG dedup)
3. Classify priority, type, tech tags
4. ✨ NEW: Generate LLM description with context
5. Create task with enhanced description
6. Embed task for future similarity search
7. Emit task.created → Auto Assignment Agent
8. Notify project members
```

---

## Deployment Steps

### Backend Changes

```bash
# 1. Update backend code
cd backend/api-gateway
git pull  # or update with latest code

# 2. Install any new dependencies (if added)
npm install

# 3. Ensure environment variables
cp .env.example .env
# Edit .env with your secrets:
# - GROQ_API_KEY (for task descriptions)
# - UNIVERSAL_DATABASE_URL (for org resolution)
# - JWT_SECRET (min 32 chars)
# - etc

# 4. Start/restart the backend
npm run start
# or with process manager:
pm2 restart api-gateway
```

### Frontend Changes (Minimal)

The frontend doesn't require changes - it automatically uses the enhanced task descriptions when tasks are created.

### Inngest Functions

No separate deployment needed - functions are registered when the backend starts.

---

## Verification

### 1. Verify Agents Route Works

```bash
curl http://localhost:4000/api/v1/agents \
  -H "Authorization: Bearer YOUR_TOKEN"
# Should return { agents: [...] }
```

### 2. Verify Task Descriptions Are Generated

Create a GitHub issue:

```bash
# In GitHub, create an issue in connected repo
# or trigger via webhook:
curl -X POST http://localhost:4000/api/v1/webhooks/github \
  -H "X-Hub-Signature-256: sha256=..." \
  -H "Content-Type: application/json" \
  -d '{...github webhook payload...}'
```

Check the task created in the UI - it should have:

- ✅ Rich description with context
- ✅ Tech tags listed
- ✅ Priority information
- ✅ Related tasks mentioned

### 3. Check Server Logs for Errors

```bash
# Monitor backend logs for LLM generation
tail -f /var/log/api-gateway.log | grep "generateTaskDescription"

# Should see:
# "generate-description step completed" (success)
# or "LLM description generation failed: ..." (graceful fallback)
```

---

## Troubleshooting

### Problem: "Org database is not available"

**Cause**: Token has no `orgId`, or org database not provisioned

**Solution**:

1. Verify JWT token includes `orgId`:
   ```bash
   jwt_decode YOUR_TOKEN  # Check for orgId field
   ```
2. Ensure org database is provisioned:
   ```sql
   SELECT * FROM organizations WHERE id = 'your_org_id';
   ```
3. If not, provision it:
   ```bash
   # Via Next.js app
   POST /api/orgs  # Create org and provision database
   ```

### Problem: "Failed to resolve team member"

**Cause**: User exists globally but not in org database

**Solution**:

```sql
-- Verify user exists globally
SELECT * FROM global_users WHERE id = 'user_id';

-- Manually create team member if needed
INSERT INTO team_members (global_user_id, email, full_name, role)
VALUES ('user_id', 'user@example.com', 'User Name', 'developer');
```

### Problem: Task descriptions are basic (no LLM enhancement)

**Cause**: `GROQ_API_KEY` not set or LLM request failed

**Solution**:

1. Set `GROQ_API_KEY`:
   ```bash
   export GROQ_API_KEY=gsk_your_key_here
   # Restart backend
   ```
2. Check logs for LLM errors:
   ```bash
   grep "LLM description generation failed" /var/log/api-gateway.log
   ```
3. Test Groq API directly:
   ```bash
   curl https://api.groq.com/openai/v1/chat/completions \
     -H "Authorization: Bearer gsk_..." \
     -H "Content-Type: application/json" \
     -d '{...}'
   ```

### Problem: Agents route returns 503 after deployment

**Checklist**:

- [ ] Is the backend running? `curl http://localhost:4000/health`
- [ ] Is UNIVERSAL_DATABASE_URL set? `echo $UNIVERSAL_DATABASE_URL`
- [ ] Is the org database accessible? `psql $UNIVERSAL_DATABASE_URL -c "SELECT 1"`
- [ ] Is JWT token valid? Check expiration and `orgId` field
- [ ] Check backend logs: `pm2 logs api-gateway`

---

## Code Changes Summary

### Files Modified

1. **inngest/functions/task-factory.ts**
   - Added `generateTaskDescription()`, `buildContextForLLM()`, `buildBasicDescription()`
   - Updated `githubIssueToTask`, `prToTask`, `githubPushToTask` handlers
   - Now calls LLM for description generation before task creation

2. **backend/api-gateway/src/routes/agents.routes.js**
   - Enhanced `GET /` route with better error diagnostics
   - Added validation for auth context, org database, actor member

3. **backend/api-gateway/src/middleware/orgDb.js**
   - Improved error handling with specific error codes
   - Added detailed messages for each failure mode
   - Better logging for debugging

### New Environment Variables

- `GROQ_API_KEY` (optional but recommended): Groq API key for LLM description generation
- `GROQ_MODEL` (optional): LLM model to use (default: `llama-3.1-8b-instant`)

---

## Performance Notes

### LLM Description Generation

- **Latency**: ~500-1500ms per task (includes Groq API call)
- **Cost**: ~0.001 per task description (using llama-3.1-8b-instant)
- **Graceful degradation**: Falls back to basic format if LLM unavailable
- **Uses Inngest steps**: LLM call is parallelizable with other task operations

### Optimization Tips

1. Use Inngest's `step.run()` for caching: If LLM fails, don't retry automatically
2. Monitor LLM latency: `grep "generate-description" logs`
3. Set aggressive timeouts on LLM calls: `timeout: 5000ms`

---

## Questions?

Check logs, verify env vars, and ensure database connectivity before investigating further.
