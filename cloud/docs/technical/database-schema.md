# Database Schema

This project uses a multi-database model:
- Universal database for global identity, billing, and tenant registry.
- Tenant database per organization for project execution data.
- Optional app-local `app` schema initialized by `database/init.sql` for Next.js-side workflows.

Primary schema source files:
- `backend/api-gateway/init.sql`
- `database/init.sql`

## Universal Database Tables

### Identity and tenancy
- `plans`
- `organizations`
- `tenants`
- `global_users`
- `org_members`
- `invitations`
- `auth_sessions`
- `password_resets`

### Billing
- `coupons`
- `subscriptions`
- `payments`
- `invoices`

### Governance and platform telemetry
- `global_audit_log`
- `ai_usage_log`
- `ai_usage_daily`
- `sso_configs`
- `db_provisioning_log`

## Tenant Database Tables

### Org bootstrap and people
- `org_settings`
- `team_members`
- `users`
- `teams`
- `team_memberships`
- `join_requests`
- `scores`
- `developer_profiles`
- `developer_availability`

### Project planning and execution
- `projects`
- `project_members`
- `epics`
- `sprints`
- `backlog_items`
- `tasks`
- `task_comments`
- `task_time_logs`

### Assignment and performance
- `assignment_log`
- `assignment_failures`
- `merit_score_history`
- `peer_ratings`
- `sprint_performance`
- `burnout_alerts`

### AI/ML and analytics
- `raw_requirements`
- `generated_stories`
- `story_point_predictions`
- `ml_model_versions`
- `sprint_progress_snapshots`
- `delay_alerts`
- `standup_entries`
- `standup_summaries`
- `sprint_reports`
- `skill_gap_log`
- `skill_gap_reports`
- `model_retraining_jobs`
- `search_index`

### Integrations and automation
- `jira_integration`
- `jira_sync_log`
- `jira_project_sync_state`
- `jira_sync_schedule`
- `github_integration`
- `github_repos`
- `github_events`
- `github_pr_events`
- `pr_review_weekly_summary`
- `github_auto_task_rules`
- `developer_api_keys`
- `developer_webhooks`
- `webhook_events`
- `notifications`
- `org_audit_log`

### Goals
- `goals`
- `goal_assignees`
- `goal_repos`
- `goal_sprints`

## App Schema (`database/init.sql`)

Tables under `app.*`:
- `app.users`
- `app.developers`
- `app.sprints`
- `app.tasks`
- `app.performance_history`
- `app.assignment_log`
- `app.delay_alerts`
- `app.skill_gap_log`
- `app.jira_sync_status`

## Core Table Details

### `projects`
Purpose: canonical project container in tenant DB.

Representative columns:
- `id` (UUID, PK)
- `name` (text)
- `slug` (text, unique)
- `description` (text)
- `owner_id` (FK to team member/user identity)
- `is_space_archived`, `is_default_space`, `space_order`
- `created_at`, `updated_at`

Indexes:
- `idx_projects_space_order`
- `idx_projects_space_archived`
- `idx_projects_default_space`

### `sprints`
Purpose: sprint windows, lifecycle state, and aggregate metrics.

Representative columns:
- `id` (UUID, PK)
- `project_id` (FK)
- `name`, `goal`
- `start_date`, `end_date`
- `status` (planned/active/completed/archive states by implementation)
- `velocity`, `completion_rate`, risk-related fields
- `created_at`, `updated_at`

Indexes:
- `idx_sprints_project`
- `idx_sprints_status`

### `tasks`
Purpose: executable work items linked to project/sprint/assignee.

Representative columns:
- `id` (UUID, PK)
- `project_id`, `sprint_id`, `assignee_id` (FKs)
- `code` (SCRUM-style code where available)
- `title`, `description`
- `status`, `priority`, `type`
- `story_points`, `tech_tags[]`
- `jira_issue_id`, GitHub link fields depending on migration level
- `created_at`, `updated_at`

Indexes:
- `idx_tasks_project`
- `idx_tasks_sprint`
- `idx_tasks_assignee`
- `idx_tasks_status`
- `idx_tasks_tech_tags` (GIN)

### `assignment_log`
Purpose: immutable record of assignment decisions.

Representative columns:
- `id` (UUID, PK)
- `task_id`, `developer_id`
- `reason`
- score breakdown columns (`merit_score_at_assignment`, match/load factors)
- `assigned_at`

Indexes:
- `idx_assignment_log_task`
- `idx_assignment_log_dev`

### `notifications`
Purpose: in-product and email/automation user notifications.

Representative columns:
- `id` (UUID, PK)
- `recipient_member_id`
- `title`, `message`, `type`
- `is_read`
- `created_at`

Indexes:
- `idx_notifications_recipient`

### `webhook_events`
Purpose: durable webhook delivery log and retry queue.

Representative columns:
- `id` (UUID, PK)
- `provider`, `event_type`
- payload/signature metadata
- `processed`, `dlq`, `retry_count`, `next_retry_at`
- `created_at`

Indexes:
- `idx_webhook_events_retry_due`
- `idx_webhook_events_dlq`

## Relationships (High-level)
- `organizations` 1:N `org_members`
- `organizations` 1:N `subscriptions` and `payments`
- `projects` 1:N `sprints`
- `projects` 1:N `tasks`
- `sprints` 1:N `tasks`
- `team_members` 1:N `tasks` via assignee fields
- `tasks` 1:N `task_comments`
- `tasks` 1:N `task_time_logs`
- `goals` 1:N (`goal_assignees`, `goal_repos`, `goal_sprints`)

## Indexing Strategy
- B-tree indexes for lookup and list pages by `status`, foreign key IDs, and timestamps.
- GIN indexes for array and full-text style search (`tech_tags`, `search_vector`).
- Composite indexes for queue/retry and timeline scans (`created_at DESC`, `next_retry_at`).

## Notes for Contributors
- Always run tenant and universal migrations together for new features touching auth/billing + project data.
- Keep route contracts aligned with DB schema changes; many endpoints proxy through Next.js BFF and assume stable JSON shapes.
- For tenant DB issues, verify `orgDbMiddleware` can resolve and validate schema tables before debugging route logic.
