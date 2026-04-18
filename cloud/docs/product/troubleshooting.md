# Troubleshooting

### Problem: GitHub connection fails
Symptoms: OAuth flow does not complete, or repository list never loads.
Cause: Missing permissions, expired token, or misconfigured integration callback.
Fix:
  Step 1: Reconnect GitHub from `/github` and re-authorize repository access.
  Step 2: Confirm integration status and webhook configuration in settings.
When to contact support: If OAuth succeeds but no repositories are ever returned.

### Problem: Tasks not being created from issues
Symptoms: New GitHub issues appear in GitHub but not in Sprint backlog/tasks.
Cause: Issue ingestion policy is disabled, webhook delivery failed, or duplicate guard skipped creation.
Fix:
  Step 1: Verify automation policy in `/scrum-master` enables issue creation.
  Step 2: Check webhook/DLQ pages and retry failed events.
When to contact support: If successful webhook deliveries still never create tasks.

### Problem: Agent assigned wrong developer
Symptoms: Tasks repeatedly go to the wrong assignee.
Cause: Skill metadata or capacity data is outdated, or confidence scoring is biased by stale inputs.
Fix:
  Step 1: Update developer skills and capacity records.
  Step 2: Re-run assignment or override manually in `/assignment`.
When to contact support: If assignment remains incorrect after profile correction.

### Problem: Sprint board not loading
Symptoms: Board page is blank, partial, or stuck loading.
Cause: Missing project/sprint context, failed data requests, or expired session.
Fix:
  Step 1: Refresh and confirm you have an active project and sprint context.
  Step 2: Re-authenticate and retry from `/board`.
When to contact support: If API requests continue failing for board endpoints.

### Problem: Notifications not appearing
Symptoms: Expected alerts or standup/report notices are missing.
Cause: Notification channels not configured, alert conditions not met, or ingestion delays.
Fix:
  Step 1: Verify notification and monitoring settings are enabled.
  Step 2: Trigger a test alert or manual monitor run.
When to contact support: If alerts exist in monitoring but never appear in notifications.

### Problem: PR not linking to task
Symptoms: PR activity does not update task state or linkage.
Cause: Missing task reference in PR metadata or failed link action.
Fix:
  Step 1: Add the task code (for example, SCRUM-42) to PR title or description.
  Step 2: Use GitHub page link action to explicitly map PR to task.
When to contact support: If explicit linking fails consistently.

### Problem: Burndown chart showing wrong data
Symptoms: Burn line appears flat, reversed, or inconsistent with actual work.
Cause: Incomplete sprint scope definition or delayed status updates.
Fix:
  Step 1: Confirm sprint start/end dates and included tasks are correct.
  Step 2: Verify task status transitions are up to date.
When to contact support: If corrected sprint data does not change chart outputs.

### Problem: Cannot invite team member
Symptoms: Invitation fails or recipient never receives invite.
Cause: Permission restrictions, invalid email, or notification delivery issues.
Fix:
  Step 1: Confirm you have team-admin permissions and valid recipient email.
  Step 2: Retry invite from `/settings/team` and check pending invites.
When to contact support: If invites fail for all recipients.

### Problem: Task stuck in IN_PROGRESS
Symptoms: Task remains in progress despite completion.
Cause: Review/merge criteria not met, or workflow transition not triggered.
Fix:
  Step 1: Verify linked PR/review requirements are complete.
  Step 2: Update task status manually and add completion note if needed.
When to contact support: If status reverts unexpectedly after manual update.

### Problem: Agent status shows error
Symptoms: Agent shows failed/paused unexpectedly and automation stops.
Cause: Configuration errors, invalid payload, or downstream service failure.
Fix:
  Step 1: Open agent logs from `/scrum-master` and identify failing step.
  Step 2: Correct config/policy and rerun the agent.
When to contact support: If agent fails with no actionable log detail.

### Problem: GitHub sync stuck
Symptoms: Sync status does not progress, and new activity is not ingested.
Cause: API rate limit, token expiration, or queued retry backlog.
Fix:
  Step 1: Revalidate token and repository permissions.
  Step 2: Trigger a manual sync and inspect webhook queue health.
When to contact support: If sync jobs remain stuck after reconnect.

### Problem: Login loop / JWT expired
Symptoms: User is redirected to sign-in repeatedly.
Cause: Expired session token, cookie issues, or auth callback mismatch.
Fix:
  Step 1: Sign out, clear browser session data, and sign in again.
  Step 2: Confirm auth endpoints and redirect URLs are correct.
When to contact support: If new sessions immediately loop again.

### Problem: Copilot agent not responding
Symptoms: Task-to-agent workflow does not return output.
Cause: Upstream AI service unavailable, timeout, or invalid payload context.
Fix:
  Step 1: Retry from the task action after confirming task context fields.
  Step 2: Check agent/AI route health and error logs.
When to contact support: If all requests timeout or fail for multiple users.

### Problem: Story points not calculating
Symptoms: Capacity and planning totals do not match expected points.
Cause: Missing or non-numeric story point values on scoped tasks.
Fix:
  Step 1: Validate story point values on backlog/sprint tasks.
  Step 2: Reopen sprint planning view to recompute totals.
When to contact support: If valid point values never appear in capacity totals.

### Problem: Sprint dates wrong timezone
Symptoms: Sprint appears to start/end on incorrect day or time.
Cause: Workspace timezone mismatch or browser locale offset.
Fix:
  Step 1: Check workspace and user timezone settings.
  Step 2: Re-save sprint dates and verify in sprint detail page.
When to contact support: If dates remain offset despite correct timezone config.

### Problem: Search not finding tasks
Symptoms: Task exists but cannot be found by query.
Cause: Filter constraints, stale index/cache, or wrong project scope.
Fix:
  Step 1: Clear filters and search by exact task code.
  Step 2: Confirm you are in the correct project and sprint context.
When to contact support: If exact code search still returns no result.

### Problem: Webhook not receiving events
Symptoms: GitHub actions occur but no webhook records appear.
Cause: Incorrect webhook URL, secret mismatch, or blocked delivery.
Fix:
  Step 1: Validate webhook endpoint and shared secret in GitHub settings.
  Step 2: Send a test webhook and inspect delivery logs/DLQ.
When to contact support: If test deliveries succeed in GitHub but never appear in Sprint.

### Problem: Standup not compiled
Symptoms: Daily standup summary is missing.
Cause: No submitted standups, failed summarization run, or schedule mismatch.
Fix:
  Step 1: Confirm users submitted standup inputs for the day.
  Step 2: Trigger standup processing manually and verify output logs.
When to contact support: If summaries fail despite valid submissions.

### Problem: Dark/light theme not saving
Symptoms: Theme resets on refresh or new navigation.
Cause: Local preference storage blocked or persistence setting conflict.
Fix:
  Step 1: Toggle theme and confirm browser storage permissions are enabled.
  Step 2: Clear stale cache and reapply preference.
When to contact support: If theme preference never persists across sessions.

### Problem: Mobile layout broken
Symptoms: Page content overflows or controls are unusable on small screens.
Cause: Viewport scaling issues, stale CSS bundle, or unsupported browser behavior.
Fix:
  Step 1: Refresh with cache cleared and retest on current mobile browser.
  Step 2: Check if issue is route-specific and capture repro steps/screenshots.
When to contact support: If responsive layout breaks consistently on supported browsers.
