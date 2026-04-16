# Dashboard Page Implementation Prompts

**Project:** Agile Scrum Master — Desktop (Electron + React + Vite)

---

## Prompt 1 — `/dashboard` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/dashboard/page.tsx`
**Route:** `/dashboard`

**Frontend:**

- Build a dashboard overview page with summary widgets/cards: active sprint progress, total open tasks, blockers count, team velocity, upcoming standups
- Include a recent activity feed (last 10 task updates)
- Show a burndown chart (use recharts) for the active sprint
- Show quick-action buttons: "Start Standup", "View Board", "Plan Sprint"
- Responsive layout using Tailwind CSS; support dark/light theme via CSS variables

**Backend (IPC via Electron):**

- IPC channel: `dashboard:getSummary` → returns `{ activeSprint, openTasks, blockers, velocity, upcomingStandups }`
- IPC channel: `dashboard:getRecentActivity` → returns array of activity events `{ id, type, message, timestamp, userId }`
- IPC channel: `dashboard:getBurndownData` → returns `{ dates[], ideal[], actual[] }`

**State:** Use local `useState` + `useEffect` for fetching. No global store needed for this page.

**Error handling:** Show skeleton loaders while fetching. Show error banners if IPC calls fail.

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/dashboard` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire dashboard widgets to `dashboard:getSummary` IPC call
- Wire activity feed to `dashboard:getRecentActivity` IPC call
- Wire burndown chart to `dashboard:getBurndownData` IPC call
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 2 — `/admin` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/admin/page.tsx`
**Route:** `/admin`

**Frontend:**

- Build an admin control panel page
- Sections: User Management table (name, email, role, status, actions), Organization Settings panel, Feature Flags toggles, Audit Log table
- User Management table: columns for name, email, role (dropdown: admin/member/viewer), active status toggle, remove button
- Audit Log: paginated table with columns: timestamp, actor, action, target, IP address
- Use Tailwind for layout; modals for confirmation dialogs

**Backend (IPC):**

- `admin:getUsers` → returns `User[]`
- `admin:updateUserRole` `{ userId, role }` → returns updated `User`
- `admin:removeUser` `{ userId }` → returns `{ success: boolean }`
- `admin:getAuditLogs` `{ page, limit }` → returns `{ logs: AuditLog[], total: number }`
- `admin:getFeatureFlags` → returns `FeatureFlag[]`
- `admin:toggleFeatureFlag` `{ flagId, enabled }` → returns updated flag

**Guards:** This page should be accessible only to users with `role === 'admin'`. Redirect to `/dashboard` otherwise.

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/admin` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire user management table to `admin:getUsers` IPC call
- User role inline editor must call `admin:updateUserRole` via IPC
- Remove user button must call `admin:removeUser` via IPC
- Audit log table must call `admin:getAuditLogs` via IPC with pagination
- Feature flags toggles must call `admin:toggleFeatureFlag` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 3 — `/assign` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/assign/page.tsx`
**Route:** `/assign`

**Frontend:**

- Build a task assignment page
- Left panel: filterable list of unassigned tasks (filter by sprint, label, priority)
- Right panel: list of team members with their current workload (task count, story points)
- Drag-and-drop or click-to-assign interaction: click a task then click a developer to assign
- Show assigned confirmation toast on success
- Display developer capacity bar (assigned points vs capacity)

**Backend (IPC):**

- `assign:getUnassignedTasks` `{ sprintId? }` → returns `Task[]`
- `assign:getDevelopersWithWorkload` → returns `{ developer: Developer, assignedPoints: number, capacity: number }[]`
- `assign:assignTask` `{ taskId, developerId }` → returns updated `Task`
- `assign:bulkAssign` `{ assignments: { taskId, developerId }[] }` → returns `Task[]`

**State:** Use local state. Optimistically update UI on assign, rollback on error.

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/assign` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire unassigned task list to `assign:getUnassignedTasks` IPC call
- Wire developer workload list to `assign:getDevelopersWithWorkload` IPC call
- Drag-drop or click-to-assign must call `assign:assignTask` via IPC
- Bulk assign must call `assign:bulkAssign` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 4 — `/assignment` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/assignment/page.tsx`
**Route:** `/assignment`

**Frontend:**

- Build an assignment overview page showing all current task-to-developer assignments
- Grouped view: group by developer, show each developer's task list with status badges
- Filter bar: filter by sprint, status, priority
- Inline reassign: click a task row to open a reassign dropdown
- Summary row per developer: total tasks, total story points, completion %

**Backend (IPC):**

- `assignment:getAllAssignments` `{ sprintId? }` → returns `{ developer: Developer, tasks: Task[] }[]`
- `assignment:reassignTask` `{ taskId, newDeveloperId }` → returns updated `Task`
- `assignment:getSprintList` → returns `Sprint[]` (for filter dropdown)

**State:** Local state with refetch after reassign.

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/assignment` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire assignments grouped by developer to `assignment:getAllAssignments` IPC call
- Inline reassign dropdown must call `assignment:reassignTask` via IPC
- Filter sprint dropdown must call `assignment:getSprintList` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 5 — `/backlog` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/backlog/page.tsx`
**Route:** `/backlog`

**Frontend:**

- Build a product backlog management page
- Table/list of all backlog items with columns: title, type (story/bug/task), priority, story points, assignee, sprint, status
- Inline editing for priority and story points
- Drag-to-reorder rows (using framer-motion or HTML5 drag API)
- "Add to Sprint" button per row — opens sprint selector dropdown
- Bulk select + bulk actions: assign to sprint, change priority, delete
- "Create Task" button opens a slide-in drawer/form

**Backend (IPC):**

- `backlog:getItems` `{ filters? }` → returns `BacklogItem[]`
- `backlog:createItem` `{ title, type, priority, points }` → returns new `BacklogItem`
- `backlog:updateItem` `{ id, changes }` → returns updated `BacklogItem`
- `backlog:reorderItems` `{ orderedIds: string[] }` → returns `{ success: boolean }`
- `backlog:addToSprint` `{ itemId, sprintId }` → returns updated `BacklogItem`
- `backlog:bulkUpdate` `{ ids, changes }` → returns updated `BacklogItem[]`
- `backlog:deleteItem` `{ id }` → returns `{ success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/backlog` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire backlog table to `backlog:getItems` IPC call
- Create task button must call `backlog:createItem` via IPC
- Inline editable priority/points must call `backlog:updateItem` via IPC
- Drag-to-reorder must call `backlog:reorderItems` via IPC with ordered IDs
- Add to sprint button must call `backlog:addToSprint` via IPC
- Bulk actions must call `backlog:bulkUpdate` / `backlog:bulkDelete` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 6 — `/board` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/board/page.tsx`
**Route:** `/board`

**Frontend:**

- Build the main Kanban board for the active sprint
- Columns: To Do, In Progress, In Review, Done (configurable)
- Task cards: show title, assignee avatar, priority badge, story points, label tags
- Drag-and-drop cards between columns (framer-motion or react-beautiful-dnd equivalent)
- Click a card to open `TaskDetailDrawer`
- Column header shows task count and total story points
- Sprint selector dropdown in the page header
- "Add Task" button per column

**Backend (IPC):**

- `board:getActiveSprint` → returns `Sprint`
- `board:getTasks` `{ sprintId }` → returns `Task[]` grouped by status
- `board:moveTask` `{ taskId, newStatus, position }` → returns updated `Task`
- `board:createTask` `{ status, sprintId, ...fields }` → returns new `Task`
- `board:getSprints` → returns `Sprint[]`

**Real-time:** Subscribe to `board:taskUpdated` socket event to sync multi-user moves.

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/board` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire sprint selector to `board:getSprints` IPC call
- Wire Kanban columns to `board:getTasks` IPC call
- Drag-drop card moves must call `board:moveTask` via IPC
- Add task per column must call `board:createTask` via IPC
- TaskDetailDrawer clicks must work with local state
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 7 — `/board/backlog` Sub-Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/board/backlog/page.tsx`
**Route:** `/board/backlog`

**Frontend:**

- Board-context backlog view (rendered inside the Board tab layout)
- Show sprint backlog items (items assigned to selected sprint but not started)
- Allow drag-and-drop from backlog into the Kanban board columns
- "Move to Board" button per item
- Filter by assignee, priority, label

**Backend (IPC):**

- `board:getSprintBacklog` `{ sprintId }` → returns `Task[]`
- `board:moveToBoard` `{ taskId, status }` → returns updated `Task`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/board/backlog` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire sprint backlog items to `board:getSprintBacklog` IPC call
- Drag-drop from backlog to board columns must call `board:moveToBoard` via IPC
- Filter controls must update local state without IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 8 — `/board/code` Sub-Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/board/code/page.tsx`
**Route:** `/board/code`

**Frontend:**

- Board code view: list of tasks linked to GitHub PRs/branches
- Table with columns: task title, linked PR, branch name, PR status (open/merged/closed), review status, author
- Click PR link → open in external browser via Electron shell
- Filter by PR status, assignee
- "Link PR" button per task → opens modal with GitHub PR URL input

**Backend (IPC):**

- `board:getTasksWithPRs` `{ sprintId }` → returns `{ task: Task, pr: GitHubPR | null }[]`
- `board:linkPR` `{ taskId, prUrl }` → returns updated `Task`
- `board:unlinkPR` `{ taskId }` → returns updated `Task`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/board/code` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire task-to-PR table to `board:getTasksWithPRs` IPC call
- PR link clicks must open external browser via Electron shell
- Link PR button must call `board:linkPR` via IPC
- Unlink PR button must call `board:unlinkPR` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 9 — `/board/forms` Sub-Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/board/forms/page.tsx`
**Route:** `/board/forms`

**Frontend:**

- Board forms view: display all forms/checklists associated with board tasks
- List of form templates: Definition of Done checklist, Bug Report form, Feature Request form
- Per task: show completion status of attached forms
- Click a form to expand and fill/view responses
- "Attach Form" button to attach a template to a task

**Backend (IPC):**

- `forms:getTemplates` → returns `FormTemplate[]`
- `forms:getTaskForms` `{ taskId }` → returns `FormResponse[]`
- `forms:submitForm` `{ taskId, templateId, answers }` → returns `FormResponse`
- `forms:attachTemplate` `{ taskId, templateId }` → returns `{ success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/board/forms` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire form templates list to `forms:getTemplates` IPC call
- Wire task forms display to `forms:getTaskForms` IPC call
- Form submission must call `forms:submitForm` via IPC
- Attach template button must call `forms:attachTemplate` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 10 — `/board/pages` Sub-Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/board/pages/page.tsx`
**Route:** `/board/pages`

**Frontend:**

- Board wiki/pages view: rich text pages linked to the board/sprint
- Sidebar list of pages (tree structure, nested)
- Main area: rendered markdown/rich text content
- "New Page" button: opens inline editor
- Edit mode: simple rich text editor (textarea with markdown preview or basic toolbar)
- Pages linked to specific tasks appear with a task badge

**Backend (IPC):**

- `pages:getList` `{ boardId }` → returns `Page[]` (tree structure)
- `pages:getContent` `{ pageId }` → returns `{ content: string, metadata: PageMeta }`
- `pages:createPage` `{ title, content, parentId? }` → returns new `Page`
- `pages:updatePage` `{ pageId, content }` → returns updated `Page`
- `pages:deletePage` `{ pageId }` → returns `{ success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/board/pages` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire pages tree sidebar to `pages:getList` IPC call
- Wire page content area to `pages:getContent` IPC call
- New page button must call `pages:createPage` via IPC
- Page edits must call `pages:updatePage` via IPC
- Delete page must call `pages:deletePage` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 11 — `/board/summary` Sub-Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/board/summary/page.tsx`
**Route:** `/board/summary`

**Frontend:**

- Sprint summary view inside board context
- Cards: sprint goal, total tasks, completed %, blockers count, days remaining
- Burndown chart (recharts LineChart): ideal vs actual
- Velocity chart (recharts BarChart): last 5 sprints
- Top contributors table: developer, tasks completed, story points delivered
- "Generate Report" button → navigates to `/reports/[sprintId]`

**Backend (IPC):**

- `sprint:getSummary` `{ sprintId }` → returns `SprintSummary`
- `sprint:getBurndown` `{ sprintId }` → returns `{ dates[], ideal[], actual[] }`
- `sprint:getVelocityHistory` `{ count: 5 }` → returns `VelocityEntry[]`
- `sprint:getContributors` `{ sprintId }` → returns `Contributor[]`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/board/summary` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire sprint summary cards to `sprint:getSummary` IPC call
- Wire burndown chart to `sprint:getBurndown` IPC call
- Wire velocity chart to `sprint:getVelocityHistory` IPC call
- Wire top contributors table to `sprint:getContributors` IPC call
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 12 — `/board/timeline` Sub-Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/board/timeline/page.tsx`
**Route:** `/board/timeline`

**Frontend:**

- Gantt-style timeline view for sprint tasks
- Horizontal scrollable timeline with date axis
- Task rows: show task bar spanning start-to-due dates, colored by status
- Hover tooltip: task details
- Drag task bar to reschedule (update due date)
- Group by assignee toggle
- Sprint date range shown as background band

**Backend (IPC):**

- `timeline:getTasks` `{ sprintId }` → returns `{ task: Task, startDate: string, dueDate: string }[]`
- `timeline:updateTaskDates` `{ taskId, startDate, dueDate }` → returns updated `Task`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/board/timeline` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire Gantt timeline to `timeline:getTasks` IPC call
- Drag task bar to reschedule must call `timeline:updateTaskDates` via IPC
- Group by assignee toggle must update local state
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 13 — `/developers` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/developers/page.tsx`
**Route:** `/developers`

**Frontend:**

- Developer directory page
- Grid of developer cards: avatar, name, role, current sprint tasks count, story points assigned
- Search bar + filter by role/team
- Click a card → navigate to `/developers/[developerId]`
- "Invite Developer" button → opens invite modal (email input)

**Backend (IPC):**

- `developers:getAll` → returns `Developer[]`
- `developers:invite` `{ email, role }` → returns `{ success: boolean, inviteId: string }`
- `developers:search` `{ query }` → returns `Developer[]`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/developers` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire developer cards grid to `developers:getAll` IPC call
- Search and filter must call `developers:search` via IPC
- Invite button must call `developers:invite` via IPC
- Card clicks must navigate to `/developers/[developerId]`
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 14 — `/developers/[developerId]` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/developers/[developerId]/page.tsx`
**Route:** `/developers/:developerId`

**Frontend:**

- Developer profile detail page
- Header: avatar, name, email, role, joined date, GitHub handle
- Stats row: tasks completed (all time), current sprint tasks, avg story points/sprint, PR merge rate
- Current tasks table: title, status, priority, due date
- Sprint history chart (recharts): points delivered per sprint (last 6)
- Skill tags section: list of skills with proficiency level badges
- "Edit Profile" button (admin only)

**Backend (IPC):**

- `developers:getById` `{ developerId }` → returns `DeveloperProfile`
- `developers:getStats` `{ developerId }` → returns `DeveloperStats`
- `developers:getCurrentTasks` `{ developerId }` → returns `Task[]`
- `developers:getSprintHistory` `{ developerId, count: 6 }` → returns `SprintHistory[]`
- `developers:updateProfile` `{ developerId, changes }` → returns updated `DeveloperProfile`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/developers/[developerId]` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire developer profile header to `developers:getById` IPC call
- Wire stats section to `developers:getStats` IPC call
- Wire current tasks table to `developers:getCurrentTasks` via IPC
- Wire sprint history chart to `developers:getSprintHistory` IPC call
- Edit profile button must call `developers:updateProfile` via IPC (admin only)
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 15 — `/github` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/github/page.tsx`
**Route:** `/github`

**Frontend:**

- GitHub integration overview page
- Connection status banner: connected org/account name, repos count, last synced timestamp
- Linked repositories list: repo name, visibility, last commit, open PRs count, sync status
- Recent PR activity feed: PR title, author, status, linked task
- "Sync Now" button → triggers manual sync
- "Manage Repos" link → navigates to `/integrations/github/repos`
- If not connected: show `GitHubConnectEmptyState` component with connect button

**Backend (IPC):**

- `github:getConnectionStatus` → returns `{ connected: boolean, org: string, lastSynced: string }`
- `github:getLinkedRepos` → returns `Repo[]`
- `github:getRecentPRs` → returns `PR[]`
- `github:syncNow` → returns `{ success: boolean, synced: number }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/github` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire connection status banner to `github:getConnectionStatus` IPC call
- Wire linked repos list to `github:getLinkedRepos` IPC call
- Wire PR activity feed to `github:getRecentPRs` IPC call
- Sync now button must call `github:syncNow` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 16 — `/goals` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/goals/page.tsx`
**Route:** `/goals`

**Frontend:**

- OKR / Goals management page
- List of goals grouped by timeframe (quarterly, monthly)
- Each goal card: title, owner, progress bar (%), linked sprints, key results list
- Expand a goal to see key results with individual progress
- "Add Goal" button → slide-in form: title, description, owner, timeframe, key results
- Status badge per goal: On Track / At Risk / Behind / Completed

**Backend (IPC):**

- `goals:getAll` → returns `Goal[]`
- `goals:create` `{ title, description, ownerId, timeframe, keyResults }` → returns new `Goal`
- `goals:update` `{ goalId, changes }` → returns updated `Goal`
- `goals:updateProgress` `{ goalId, keyResultId, progress }` → returns updated `Goal`
- `goals:delete` `{ goalId }` → returns `{ success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/goals` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire goals list to `goals:getAll` IPC call grouped by timeframe
- Add goal button must call `goals:create` via IPC
- Goal card updates must call `goals:update` via IPC
- Key result progress slider must call `goals:updateProgress` via IPC
- Delete goal must call `goals:delete` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 17 — `/integrations` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/integrations/page.tsx`
**Route:** `/integrations`

**Frontend:**

- Integration hub page
- Grid of integration cards: GitHub, Jira, Slack, Notion, Linear, etc.
- Each card: logo, name, description, connection status badge (Connected/Disconnected)
- Connected integrations show: last sync time, "Disconnect" button, "Settings" button
- Disconnected integrations show: "Connect" button
- Click "Connect" → opens OAuth flow or config modal per integration type

**Backend (IPC):**

- `integrations:getAll` → returns `Integration[]` with status
- `integrations:connect` `{ type, credentials }` → returns `{ success: boolean, integration: Integration }`
- `integrations:disconnect` `{ integrationId }` → returns `{ success: boolean }`
- `integrations:syncNow` `{ integrationId }` → returns `{ success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/integrations` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire integration cards grid to `integrations:getAll` IPC call
- Connect button per integration must call `integrations:connect` via IPC
- Disconnect button must call `integrations:disconnect` via IPC
- Sync now button must call `integrations:syncNow` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 18 — `/integrations/github/repos` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/integrations/github/repos/page.tsx`
**Route:** `/integrations/github/repos`

**Frontend:**

- GitHub repository management page
- Search bar to find repos from the connected GitHub org
- Table: repo name, visibility (public/private), default branch, open PRs, linked project, sync toggle
- Toggle per repo to enable/disable sync
- "Link to Project" dropdown per repo → maps repo to an internal project
- Bulk enable/disable selected repos

**Backend (IPC):**

- `github:getAvailableRepos` → returns `GitHubRepo[]` (from GitHub API via main process)
- `github:getLinkedRepos` → returns `LinkedRepo[]`
- `github:toggleRepoSync` `{ repoId, enabled }` → returns updated `LinkedRepo`
- `github:linkRepoToProject` `{ repoId, projectId }` → returns `{ success: boolean }`
- `github:bulkToggle` `{ repoIds, enabled }` → returns `LinkedRepo[]`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/integrations/github/repos` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire repo search to `github:getAvailableRepos` IPC call
- Wire linked repos table to `github:getLinkedRepos` IPC call
- Sync toggle per repo must call `github:toggleRepoSync` via IPC
- Link to project dropdown must call `github:linkRepoToProject` via IPC
- Bulk enable/disable must call `github:bulkToggle` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 19 — `/monitoring` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/monitoring/page.tsx`
**Route:** `/monitoring`

**Frontend:**

- System/process monitoring page
- Status cards: API server health, database connection, background job queue, webhook queue
- Each card: status badge (Healthy/Degraded/Down), latency ms, last checked timestamp
- Error log table: timestamp, service, error message, severity, status (resolved/open)
- Webhook DLQ panel: embed `WebhookDLQPanel` component
- Jira sync log panel: embed `JiraSyncLogPanel` component
- "Refresh" button to re-check all statuses

**Backend (IPC):**

- `monitoring:getHealthStatus` → returns `ServiceHealth[]`
- `monitoring:getErrorLogs` `{ limit, severity? }` → returns `ErrorLog[]`
- `monitoring:getWebhookDLQ` → returns `WebhookDLQItem[]`
- `monitoring:retryWebhook` `{ webhookId }` → returns `{ success: boolean }`
- `monitoring:getJiraSyncLogs` → returns `JiraSyncLog[]`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/monitoring` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire status cards to `monitoring:getHealthStatus` IPC call
- Wire error log table to `monitoring:getErrorLogs` IPC call
- WebhookDLQPanel must call `monitoring:getWebhookDLQ` and `monitoring:retryWebhook` via IPC
- JiraSyncLogPanel must call `monitoring:getJiraSyncLogs` via IPC
- Refresh button must re-call all health endpoints via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 20 — `/onboarding` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/onboarding/page.tsx`
**Route:** `/onboarding`

**Frontend:**

- Onboarding checklist/wizard page for new users or new orgs
- Step-by-step progress: (1) Create Organization → (2) Invite Team → (3) Connect GitHub → (4) Create First Project → (5) Create First Sprint
- Each step shows: title, description, status (completed/pending/skipped), action button
- Progress bar at the top showing overall completion %
- "Skip" option per step
- Confetti or celebration animation when all steps complete

**Backend (IPC):**

- `onboarding:getStatus` → returns `{ steps: OnboardingStep[], completedCount: number }`
- `onboarding:markStepComplete` `{ stepId }` → returns updated `OnboardingStep`
- `onboarding:skipStep` `{ stepId }` → returns updated `OnboardingStep`
- `onboarding:reset` → returns `{ success: boolean }` (for dev/testing)

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/onboarding` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire onboarding checklist to `onboarding:getStatus` IPC call
- Step completion button must call `onboarding:markStepComplete` via IPC
- Skip button per step must call `onboarding:skipStep` via IPC
- Progress bar must reflect actual completion state
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 21 — `/profile` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/profile/page.tsx`
**Route:** `/profile`

**Frontend:**

- Current user profile page
- Header: editable avatar (click to upload), display name, email (read-only), role badge
- Form sections: Personal Info (name, bio, timezone), Notification Preferences (toggles), Linked Accounts (GitHub username, Slack)
- "Save Changes" button with loading state
- "Change Password" section: current password, new password, confirm — separate save button
- Activity stats: tasks completed, PRs reviewed, standups attended

**Backend (IPC):**

- `profile:getCurrent` → returns `UserProfile`
- `profile:update` `{ name, bio, timezone, notifications }` → returns updated `UserProfile`
- `profile:changePassword` `{ currentPassword, newPassword }` → returns `{ success: boolean }`
- `profile:uploadAvatar` `{ base64Image }` → returns `{ avatarUrl: string }`
- `profile:getActivityStats` → returns `ActivityStats`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/profile` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire profile form to `profile:getCurrent` IPC call on mount
- Save changes button must call `profile:update` via IPC
- Avatar upload must call `profile:uploadAvatar` via IPC
- Change password button must call `profile:changePassword` via IPC
- Activity stats must call `profile:getActivityStats` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 22 — `/projects/[projectId]` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/projects/[projectId]/page.tsx`
**Route:** `/projects/:projectId`

**Frontend:**

- Project detail page
- Header: project name, description, status badge, owner, dates, linked GitHub repos
- Tabs: Overview | Sprints | Members | Settings
- Overview tab: project stats (total tasks, open, completed), sprint history list, activity feed
- Sprints tab: list of all sprints for this project with status and dates
- Members tab: list of project members with roles, "Add Member" button
- Settings tab: edit project name/description/status, danger zone (archive/delete)

**Backend (IPC):**

- `projects:getById` `{ projectId }` → returns `Project`
- `projects:getSprints` `{ projectId }` → returns `Sprint[]`
- `projects:getMembers` `{ projectId }` → returns `ProjectMember[]`
- `projects:addMember` `{ projectId, userId, role }` → returns `ProjectMember`
- `projects:update` `{ projectId, changes }` → returns updated `Project`
- `projects:archive` `{ projectId }` → returns `{ success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/projects/[projectId]` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire project header to `projects:getById` IPC call
- Wire sprints tab to `projects:getSprints` IPC call
- Wire members tab to `projects:getMembers` IPC call
- Add member button must call `projects:addMember` via IPC
- Edit project must call `projects:update` via IPC
- Archive project must call `projects:archive` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 23 — `/reports` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/reports/page.tsx`
**Route:** `/reports`

**Frontend:**

- Sprint reports listing page
- Table/list of all past sprint reports: sprint name, dates, velocity, completion %, generated date
- Filter by project, date range
- "View Report" button per row → navigates to `/reports/[sprintId]`
- "Generate Report" button → generates a new report for a selected completed sprint
- Summary charts at top: average velocity (last 6 sprints), average completion %

**Backend (IPC):**

- `reports:getAll` `{ projectId?, dateRange? }` → returns `SprintReport[]`
- `reports:generate` `{ sprintId }` → returns new `SprintReport`
- `reports:getVelocityHistory` `{ count: 6 }` → returns `VelocityEntry[]`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/reports` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire reports table to `reports:getAll` IPC call with filters
- Wire velocity/completion summary charts to `reports:getVelocityHistory` IPC call
- Generate report button must call `reports:generate` via IPC
- View report row clicks must navigate to `/reports/[sprintId]`
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 24 — `/reports/[sprintId]` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/reports/[sprintId]/page.tsx`
**Route:** `/reports/:sprintId`

**Frontend:**

- Detailed sprint report page
- Header: sprint name, dates, goal, status
- Section: Sprint Stats — total tasks, completed, carried over, added mid-sprint
- Section: Burndown chart (recharts)
- Section: Team Performance table — developer, tasks completed, story points, PR count
- Section: Blockers & Risks — list of flagged blockers with resolution notes
- Section: Retrospective notes (editable text area if role = admin/scrum master)
- "Export PDF" button (triggers IPC to generate PDF)
- "Share Report" button (copies a shareable link)

**Backend (IPC):**

- `reports:getBySprintId` `{ sprintId }` → returns full `SprintReport`
- `reports:updateRetroNotes` `{ sprintId, notes }` → returns `{ success: boolean }`
- `reports:exportPDF` `{ sprintId }` → returns `{ filePath: string }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/reports/[sprintId]` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire sprint report sections to `reports:getBySprintId` IPC call
- Retrospective notes editor must call `reports:updateRetroNotes` via IPC
- Export PDF button must call `reports:exportPDF` via IPC
- Share report button must copy shareable link (may use local state)
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 25 — `/scrum-master` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/scrum-master/page.tsx`
**Route:** `/scrum-master`

**Frontend:**

- Scrum Master control center page
- Today's agenda panel: standups scheduled, sprint events, review/retro dates
- Active impediments list: task title, blocker description, raised by, days blocked, resolve button
- Sprint health meter: composite score (velocity, completion %, team sentiment)
- AI Agent shortcuts: "Run Daily Analysis", "Detect Blockers", "Generate Standup Summary"
- Recent AI agent activity log

**Backend (IPC):**

- `scrumMaster:getAgenda` → returns `AgendaItem[]`
- `scrumMaster:getImpediments` → returns `Impediment[]`
- `scrumMaster:resolveImpediment` `{ impedimentId }` → returns updated `Impediment`
- `scrumMaster:getSprintHealth` → returns `SprintHealth`
- `scrumMaster:runAgentAction` `{ action }` → returns `AgentResult`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/scrum-master` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire agenda panel to `scrumMaster:getAgenda` IPC call
- Wire impediments list to `scrumMaster:getImpediments` IPC call
- Resolve impediment button must call `scrumMaster:resolveImpediment` via IPC
- Wire sprint health meter to `scrumMaster:getSprintHealth` IPC call
- AI shortcuts must call `scrumMaster:runAgentAction` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 26 — `/scrum-master/[taskId]` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/scrum-master/[taskId]/page.tsx`
**Route:** `/scrum-master/:taskId`

**Frontend:**

- Scrum master task deep-dive page for a specific task
- Task header: title, status, assignee, sprint, priority, story points
- AI analysis panel: complexity score, risk flags, suggested actions
- Activity timeline: all events on this task (created, assigned, status changes, comments)
- Blocker section: add/remove blockers with description
- Comments section: threaded comments with timestamps
- Related tasks: linked/blocked-by tasks list

**Backend (IPC):**

- `tasks:getById` `{ taskId }` → returns `Task`
- `tasks:getActivityLog` `{ taskId }` → returns `ActivityEvent[]`
- `tasks:addBlocker` `{ taskId, description }` → returns updated `Task`
- `tasks:removeBlocker` `{ taskId, blockerId }` → returns updated `Task`
- `tasks:addComment` `{ taskId, content }` → returns `Comment`
- `scrumMaster:analyzeTask` `{ taskId }` → returns `AIAnalysis`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/scrum-master/[taskId]` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire task header to `tasks:getById` IPC call
- Wire AI analysis panel to `scrumMaster:analyzeTask` IPC call
- Wire activity timeline to `tasks:getActivityLog` IPC call
- Add/remove blocker buttons must call `tasks:addBlocker` / `tasks:removeBlocker` via IPC
- Add comment must call `tasks:addComment` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 27 — `/scrum-master/agent/[agentId]` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/scrum-master/agent/[agentId]/page.tsx`
**Route:** `/scrum-master/agent/:agentId`

**Frontend:**

- AI agent detail/conversation page
- Header: agent name, type, status (running/idle), last run time
- Chat-style conversation thread showing agent messages and actions taken
- Input bar at bottom to send instructions to the agent
- Side panel: agent config (model, tools enabled, memory), recent runs history
- "Stop Agent" / "Run Agent" toggle button
- Action log: list of concrete actions taken (task updated, comment posted, etc.)

**Backend (IPC):**

- `agent:getById` `{ agentId }` → returns `Agent`
- `agent:getConversation` `{ agentId }` → returns `Message[]`
- `agent:sendMessage` `{ agentId, content }` → returns `Message`
- `agent:getActionLog` `{ agentId }` → returns `AgentAction[]`
- `agent:toggleRun` `{ agentId, running }` → returns updated `Agent`
- `agent:updateConfig` `{ agentId, config }` → returns updated `Agent`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/scrum-master/agent/[agentId]` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire agent header to `agent:getById` IPC call
- Wire conversation thread to `agent:getConversation` IPC call
- Input bar send button must call `agent:sendMessage` via IPC
- Wire action log to `agent:getActionLog` IPC call
- Run/stop toggle must call `agent:toggleRun` via IPC
- Config updates must call `agent:updateConfig` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 28 — `/settings` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/settings/page.tsx`
**Route:** `/settings`

**Frontend:**

- Settings hub page with a left settings nav and right content area
- Nav items: Profile, Organization, Team, Billing, Integrations, Developer Management, Preferences
- Default content: redirect to `/settings/profile` or show a settings overview card grid
- Each nav item links to the corresponding settings sub-route
- Highlight active nav item based on current sub-route

**Backend (IPC):** No direct IPC on this page; sub-pages handle their own calls.

**Note:** This page acts as a layout wrapper. Ensure the settings sub-nav is consistent across all `/settings/*` pages.

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/settings` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Settings hub layout with left nav is pre-built
- Wire default content redirect to `/settings/profile` or overview grid
- Nav item highlighting must track current sub-route
- All navigation must work without modifying existing UI structure

---

## Prompt 29 — `/settings/billing` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/settings/billing/page.tsx`
**Route:** `/settings/billing`

**Frontend:**

- Billing & subscription settings page
- Current plan card: plan name, price, renewal date, seats used/available
- "Upgrade Plan" / "Manage Subscription" button → opens external billing portal URL
- Payment method section: card last 4 digits, expiry, "Update Card" button
- Invoice history table: date, amount, status (paid/failed), "Download PDF" per row
- Usage metrics: seats used, API calls this month, storage used

**Backend (IPC):**

- `billing:getPlan` → returns `Plan`
- `billing:getPaymentMethod` → returns `PaymentMethod`
- `billing:getInvoices` → returns `Invoice[]`
- `billing:getUsage` → returns `UsageStats`
- `billing:getBillingPortalUrl` → returns `{ url: string }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/settings/billing` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire plan card to `billing:getPlan` IPC call
- Wire payment method section to `billing:getPaymentMethod` IPC call
- Wire invoice history table to `billing:getInvoices` IPC call
- Wire usage metrics to `billing:getUsage` IPC call
- Manage subscription button must call `billing:getBillingPortalUrl` and open in external browser
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 30 — `/settings/developer-management` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/settings/developer-management/page.tsx`
**Route:** `/settings/developer-management`

**Frontend:**

- Developer/seat management settings page
- Table of all developers in the org: name, email, role, teams, last active, status
- Inline role editor (dropdown)
- "Remove from Org" button with confirmation
- "Invite Developer" button → email input + role select modal
- Pending invitations section: email, invited by, expiry, "Revoke" button
- Seats summary: used/total seats with upgrade prompt if near limit

**Backend (IPC):**

- `developers:getOrgMembers` → returns `OrgMember[]`
- `developers:updateRole` `{ userId, role }` → returns updated `OrgMember`
- `developers:removeFromOrg` `{ userId }` → returns `{ success: boolean }`
- `developers:inviteToOrg` `{ email, role }` → returns `Invitation`
- `developers:getPendingInvitations` → returns `Invitation[]`
- `developers:revokeInvitation` `{ invitationId }` → returns `{ success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/settings/developer-management` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire developer table to `developers:getOrgMembers` IPC call
- Role inline editor must call `developers:updateRole` via IPC
- Remove button must call `developers:removeFromOrg` via IPC
- Invite button must call `developers:inviteToOrg` via IPC
- Pending invitations must call `developers:getPendingInvitations` via IPC
- Revoke button must call `developers:revokeInvitation` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 31 — `/settings/integrations` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/settings/integrations/page.tsx`
**Route:** `/settings/integrations`

**Frontend:**

- Settings-context integration management (more detailed than the `/integrations` hub)
- List of all integration types with detailed config forms when connected
- GitHub: connected account, webhook URL, sync frequency dropdown
- Jira: connected workspace, project mapping table (Jira project → internal project)
- Slack: connected workspace, notification channel config per event type
- Each section: "Save Config" button, "Disconnect" button
- Webhook settings: show webhook secret, "Regenerate Secret" button

**Backend (IPC):**

- `integrations:getConfig` `{ type }` → returns `IntegrationConfig`
- `integrations:updateConfig` `{ type, config }` → returns updated `IntegrationConfig`
- `integrations:regenerateWebhookSecret` `{ type }` → returns `{ secret: string }`
- `integrations:getJiraProjectMappings` → returns `ProjectMapping[]`
- `integrations:saveJiraMapping` `{ jiraProjectId, internalProjectId }` → returns `ProjectMapping`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/settings/integrations` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire integration config sections to `integrations:getConfig` IPC call per type
- Save config buttons must call `integrations:updateConfig` via IPC
- Webhook secret regenerate must call `integrations:regenerateWebhookSecret` via IPC
- Jira mappings must call `integrations:getJiraProjectMappings` / `integrations:saveJiraMapping` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 32 — `/settings/org` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/settings/org/page.tsx`
**Route:** `/settings/org`

**Frontend:**

- Organization settings page
- Form: org name, org slug (read-only after creation), org logo upload, description, industry, size
- Org-wide preferences: default sprint length (days), working days checkboxes, timezone
- Danger zone: "Transfer Ownership" (select new owner dropdown), "Delete Organization" (confirmation modal with org name typed)
- "Save Changes" button

**Backend (IPC):**

- `org:getSettings` → returns `OrgSettings`
- `org:update` `{ name, description, industry, size, preferences }` → returns updated `OrgSettings`
- `org:uploadLogo` `{ base64Image }` → returns `{ logoUrl: string }`
- `org:transferOwnership` `{ newOwnerId }` → returns `{ success: boolean }`
- `org:delete` `{ confirmName }` → returns `{ success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/settings/org` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire org settings form to `org:getSettings` IPC call
- Save changes button must call `org:update` via IPC
- Logo upload must call `org:uploadLogo` via IPC
- Transfer ownership must call `org:transferOwnership` via IPC
- Delete organization must call `org:delete` via IPC with confirmation
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 33 — `/settings/preferences` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/settings/preferences/page.tsx`
**Route:** `/settings/preferences`

**Frontend:**

- User preferences settings page
- Theme selector: Light / Dark / System (uses `theme-store.ts`)
- Language dropdown (future i18n support, show as coming soon if not implemented)
- Notification preferences: email notifications toggles per event type, in-app notification toggles
- Keyboard shortcuts reference section (read-only table)
- Auto-task rules section: embed `AutoTaskRulesPanel` component
- "Save Preferences" button

**Backend (IPC):**

- `preferences:get` → returns `UserPreferences`
- `preferences:update` `{ theme, notifications, language }` → returns updated `UserPreferences`
- `preferences:getAutoTaskRules` → returns `AutoTaskRule[]`
- `preferences:saveAutoTaskRules` `{ rules }` → returns `AutoTaskRule[]`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/settings/preferences` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire theme selector to `theme-store.ts` (local state, no IPC needed)
- Notification preferences must call `preferences:update` via IPC
- Auto-task rules panel must call `preferences:getAutoTaskRules` / `preferences:saveAutoTaskRules` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 34 — `/settings/profile` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/settings/profile/page.tsx`
**Route:** `/settings/profile`

**Frontend:**

- Profile settings within settings layout (distinct from `/profile` which is the public profile view)
- Avatar upload section
- Form: display name, job title, bio (textarea), phone number
- Account section: email (read-only with "Change Email" flow), connected SSO providers
- Security section: "Change Password", "Enable 2FA" toggle, active sessions list with "Revoke" per session
- "Save" button per section

**Backend (IPC):**

- `profile:get` → returns `UserProfile`
- `profile:update` `{ displayName, title, bio, phone }` → returns updated `UserProfile`
- `profile:uploadAvatar` `{ base64Image }` → returns `{ avatarUrl: string }`
- `profile:changeEmail` `{ newEmail, password }` → returns `{ success: boolean }`
- `profile:getSessions` → returns `Session[]`
- `profile:revokeSession` `{ sessionId }` → returns `{ success: boolean }`
- `profile:toggle2FA` `{ enabled }` → returns `{ qrCodeUrl?: string, success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/settings/profile` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire profile form to `profile:get` IPC call on mount
- Save button must call `profile:update` via IPC
- Avatar upload must call `profile:uploadAvatar` via IPC
- Email change must call `profile:changeEmail` via IPC
- Active sessions must call `profile:getSessions` via IPC; revoke must call `profile:revokeSession` via IPC
- 2FA toggle must call `profile:toggle2FA` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 35 — `/settings/team` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/settings/team/page.tsx`
**Route:** `/settings/team`

**Frontend:**

- Team management settings page
- List of teams in the org: team name, members count, projects count, lead
- "Create Team" button → modal: team name, description, select lead
- Expand a team row: show member list, "Add Member" button, "Remove" per member
- "Edit Team" and "Delete Team" per row
- Assign teams to projects section

**Backend (IPC):**

- `teams:getAll` → returns `Team[]`
- `teams:create` `{ name, description, leadId }` → returns new `Team`
- `teams:update` `{ teamId, changes }` → returns updated `Team`
- `teams:delete` `{ teamId }` → returns `{ success: boolean }`
- `teams:addMember` `{ teamId, userId }` → returns updated `Team`
- `teams:removeMember` `{ teamId, userId }` → returns updated `Team`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/settings/team` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire team list to `teams:getAll` IPC call
- Create team button must call `teams:create` via IPC
- Edit team must call `teams:update` via IPC
- Delete team must call `teams:delete` via IPC
- Add/remove members must call `teams:addMember` / `teams:removeMember` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 36 — `/skill-gap` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/skill-gap/page.tsx`
**Route:** `/skill-gap`

**Frontend:**

- Skill gap analysis page
- Matrix view: rows = team members, columns = skill categories (Frontend, Backend, DevOps, Testing, etc.)
- Each cell: proficiency level badge (1–5 or Beginner/Intermediate/Expert)
- Heat map color coding: red = low, green = high
- Summary panel: most critical skill gaps (sorted by importance vs availability)
- "Required Skills" section: skills needed for upcoming sprint tasks (auto-detected from task labels)
- "Assign Training" button per gap → opens modal with training resource link input

**Backend (IPC):**

- `skillGap:getMatrix` → returns `{ members: Developer[], skills: Skill[], matrix: SkillLevel[][] }`
- `skillGap:updateSkillLevel` `{ memberId, skillId, level }` → returns updated matrix row
- `skillGap:getRequiredSkills` `{ sprintId }` → returns `RequiredSkill[]`
- `skillGap:assignTraining` `{ memberId, skillId, resourceUrl }` → returns `{ success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/skill-gap` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire skill matrix to `skillGap:getMatrix` IPC call
- Proficiency level updates must call `skillGap:updateSkillLevel` via IPC
- Required skills section must call `skillGap:getRequiredSkills` via IPC
- Training assignment button must call `skillGap:assignTraining` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 37 — `/sprint` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/sprint/page.tsx`
**Route:** `/sprint`

**Frontend:**

- Current sprint overview page
- Sprint header: name, goal, start/end dates, status badge, days remaining countdown
- Progress stats: total tasks, completed, in progress, blocked
- Quick actions: "Start Sprint" / "Complete Sprint" / "Cancel Sprint" based on current status
- Task list grouped by status with inline status change
- Sprint events: upcoming review, retro dates

**Backend (IPC):**

- `sprint:getCurrent` → returns `Sprint`
- `sprint:getTasks` `{ sprintId }` → returns `Task[]`
- `sprint:updateStatus` `{ sprintId, status }` → returns updated `Sprint`
- `sprint:getEvents` `{ sprintId }` → returns `SprintEvent[]`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/sprint` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire sprint header to `sprint:getCurrent` IPC call
- Task list must call `sprint:getTasks` via IPC
- Status change buttons must call `sprint:updateStatus` via IPC
- Events section must call `sprint:getEvents` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 38 — `/sprint/[sprintId]` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/sprint/[sprintId]/page.tsx`
**Route:** `/sprint/:sprintId`

**Frontend:**

- Sprint detail page for any sprint (past or current), identified by `sprintId` param
- Same structure as `/sprint` but for a specific sprint
- Header: sprint name, goal, dates, status
- Task list with status grouping
- Stats and metrics section
- Link to sprint report: "View Full Report" → `/reports/[sprintId]`
- "Edit Sprint" button → inline form for name/goal/dates

**Backend (IPC):**

- `sprint:getById` `{ sprintId }` → returns `Sprint`
- `sprint:getTasks` `{ sprintId }` → returns `Task[]`
- `sprint:update` `{ sprintId, changes }` → returns updated `Sprint`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/sprint/[sprintId]` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire sprint detail to `sprint:getById` IPC call
- Tab content must call appropriate IPC handlers per tab: `sprint:getTasks`, etc.
- Edit sprint must call `sprint:update` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 39 — `/sprint-plan` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/sprint-plan/page.tsx`
**Route:** `/sprint-plan`

**Frontend:**

- Sprint planning page (kebab-case route)
- Two-column layout: left = product backlog, right = sprint bucket
- Drag items from backlog into sprint bucket
- Sprint bucket header: sprint name input, start/end date pickers, capacity indicator (total story points vs team capacity)
- Backlog filters: priority, label, assignee
- "Save Sprint Plan" button → creates a new sprint with the selected tasks
- "AI Suggest" button → calls AI to auto-fill sprint based on priority and capacity

**Backend (IPC):**

- `sprintPlan:getBacklog` → returns `BacklogItem[]`
- `sprintPlan:getTeamCapacity` `{ startDate, endDate }` → returns `{ totalPoints: number, members: CapacityEntry[] }`
- `sprintPlan:savePlan` `{ name, goal, startDate, endDate, taskIds }` → returns new `Sprint`
- `sprintPlan:aiSuggest` `{ capacity, sprintLength }` → returns suggested `BacklogItem[]`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/sprint-plan` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire backlog column to `sprintPlan:getBacklog` IPC call
- Sprint capacity indicator must call `sprintPlan:getTeamCapacity` via IPC
- Drag-and-drop interactions for sprint planning must work correctly
- Save sprint plan button must call `sprintPlan:savePlan` via IPC
- AI Suggest button must call `sprintPlan:aiSuggest` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 40 — `/sprint_plan` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/sprint_plan/page.tsx`
**Route:** `/sprint_plan`

**Frontend:**

- This is a legacy alias route for sprint planning (underscore variant)
- Render a redirect notice: "This page has moved" with a button linking to `/sprint-plan`
- OR simply render the same `SprintPlanPage` component used by `/sprint-plan` (reuse, don't duplicate logic)
- Add a console warning in dev mode noting this is a deprecated route

**Backend (IPC):** Same as `/sprint-plan` — reuse the same IPC calls if rendering the full page.

**Note:** Long term this route should be deprecated. Consider adding a redirect in `AppRouter.tsx`.

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/sprint_plan` is already fully implemented (legacy route)
- Do NOT redesign, rewrite, or add new UI components
- Render same `SprintPlanPage` component as `/sprint-plan` or add redirect notice
- IPC calls are same as `/sprint-plan` if rendering full page
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 41 — `/sprints` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/sprints/page.tsx`
**Route:** `/sprints`

**Frontend:**

- All sprints listing page
- Table/list of all sprints: name, project, status (planning/active/completed/cancelled), dates, velocity, completion %
- Filter by project, status, date range
- "Create Sprint" button → opens modal: name, goal, start/end dates, project selector
- Click a sprint row → navigate to `/sprints/[sprintId]`
- Active sprint highlighted at the top

**Backend (IPC):**

- `sprints:getAll` `{ projectId?, status? }` → returns `Sprint[]`
- `sprints:create` `{ name, goal, startDate, endDate, projectId }` → returns new `Sprint`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/sprints` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire sprint list to `sprints:getAll` IPC call with filter params
- Create Sprint button must call `sprints:create` via IPC
- Sprint row click must navigate to `/sprints/[sprintId]`
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 42 — `/sprints/[sprintId]` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/sprints/[sprintId]/page.tsx`
**Route:** `/sprints/:sprintId`

**Frontend:**

- Sprint detail page within the sprints section context
- Tabs: Tasks | Summary | Team | Settings
- Tasks tab: full task list with filters, inline status change, "Add Task" button
- Summary tab: burndown chart, velocity, completion stats
- Team tab: member contributions for this sprint
- Settings tab: edit sprint name/goal/dates/status, danger zone delete

**Backend (IPC):**

- `sprints:getById` `{ sprintId }` → returns `Sprint`
- `sprints:getTasks` `{ sprintId }` → returns `Task[]`
- `sprints:update` `{ sprintId, changes }` → returns updated `Sprint`
- `sprints:delete` `{ sprintId }` → returns `{ success: boolean }`
- `sprints:getSummary` `{ sprintId }` → returns `SprintSummary`
- `sprints:getContributions` `{ sprintId }` → returns `MemberContribution[]`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/sprints/[sprintId]` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire sprint detail to `sprints:getById` IPC call
- Tabs must call appropriate IPC handlers per tab: `sprints:getTasks`, `sprints:getSummary`, `sprints:getContributions`
- Update sprint must call `sprints:update` via IPC
- Delete sprint must call `sprints:delete` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 43 — `/standup` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/standup/page.tsx`
**Route:** `/standup`

**Frontend:**

- Daily standup page
- Team member list with standup input per member: Yesterday, Today, Blockers (3 text inputs)
- Timer component: configurable duration (default 15 min), countdown with start/pause/reset
- Submit standup per member with confirmation
- Historical standup log: date picker to view past standups
- AI summary button: "Generate Summary" → shows AI-generated standup summary card
- Export: "Copy Summary" button

**Backend (IPC):**

- `standup:getToday` → returns `StandupEntry[]` for current date (pre-filled if submitted)
- `standup:submit` `{ userId, yesterday, today, blockers }` → returns `StandupEntry`
- `standup:getHistory` `{ date }` → returns `StandupEntry[]`
- `standup:generateSummary` `{ date }` → returns `{ summary: string }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/standup` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire standup form to `standup:getToday` IPC call
- Submit standup button must call `standup:submit` via IPC per member
- Historical date picker must call `standup:getHistory` via IPC
- Generate Summary button must call `standup:generateSummary` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 44 — `/tasks` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/tasks/page.tsx`
**Route:** `/tasks`

**Frontend:**

- All tasks listing page (cross-sprint, cross-project)
- Table view with columns: title, project, sprint, assignee, status, priority, story points, due date, labels
- Filter bar: project, sprint, assignee, status, priority, label
- Toggle view: table vs card grid
- Click a row → navigate to `/tasks/[taskId]` or open `TaskDetailDrawer`
- "Create Task" button → opens task creation form drawer
- Bulk select + bulk actions: assign, change status, move to sprint, delete

**Backend (IPC):**

- `tasks:getAll` `{ filters? }` → returns `Task[]`
- `tasks:create` `{ title, description, projectId, sprintId, assigneeId, priority, points, labels }` → returns new `Task`
- `tasks:bulkUpdate` `{ ids, changes }` → returns `Task[]`
- `tasks:bulkDelete` `{ ids }` → returns `{ success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/tasks` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire task list to `tasks:getAll` IPC call with filter params
- Create Task button must call `tasks:create` via IPC
- Task row click must navigate to `/tasks/[taskId]` or open TaskDetailDrawer
- Bulk select + actions must call `tasks:bulkUpdate` / `tasks:bulkDelete` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 45 — `/tasks/[taskId]` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/tasks/[taskId]/page.tsx`
**Route:** `/tasks/:taskId`

**Frontend:**

- Full-page task detail view (standalone, not drawer)
- Left column: task title (inline editable), description (rich text), acceptance criteria checklist, sub-tasks list
- Right column: metadata (status, assignee, sprint, priority, points, labels, due date) — all editable inline
- Activity tab: full changelog + comment thread
- Attachments section: file list with upload button
- Linked items: parent task, blocked-by tasks, related tasks
- "Delete Task" button in danger zone

**Backend (IPC):**

- `tasks:getById` `{ taskId }` → returns full `Task` with all relations
- `tasks:update` `{ taskId, changes }` → returns updated `Task`
- `tasks:addComment` `{ taskId, content }` → returns `Comment`
- `tasks:deleteComment` `{ commentId }` → returns `{ success: boolean }`
- `tasks:addAttachment` `{ taskId, filePath }` → returns `Attachment`
- `tasks:linkTask` `{ taskId, targetId, linkType }` → returns `TaskLink`
- `tasks:delete` `{ taskId }` → returns `{ success: boolean }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/tasks/[taskId]` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire task detail to `tasks:getById` IPC call
- Inline editable fields must call `tasks:update` via IPC on blur/save
- Comments section must call `tasks:addComment` / `tasks:deleteComment` via IPC
- Attachments must call `tasks:addAttachment` via IPC
- Link tasks must call `tasks:linkTask` via IPC
- Delete task must call `tasks:delete` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 46 — `/teams` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/teams/page.tsx`
**Route:** `/teams`

**Frontend:**

- Teams overview page (view-only, management is in settings)
- Grid of team cards: team name, lead avatar + name, member count, active sprint, current velocity
- Click a team card → expand inline or navigate to team detail view
- Expanded view: member list with avatars, current tasks per member, team velocity chart (recharts)
- Filter/search teams by name
- "Create Team" shortcut button → navigates to `/settings/team`

**Backend (IPC):**

- `teams:getAll` → returns `Team[]`
- `teams:getDetail` `{ teamId }` → returns `{ team: Team, members: Developer[], currentTasks: Task[], velocity: VelocityEntry[] }`

**CRITICAL: Do NOT Change UI**

- Frontend UI for `/teams` is already fully implemented
- Do NOT redesign, rewrite, or add new UI components
- Wire team cards to `teams:getAll` IPC call
- Team detail expansion must call `teams:getDetail` via IPC
- All IPC calls must use `window.desktopApi.invoke()` — no direct HTTP

---

## Prompt 47 — `/webhooks` Page

You are a senior full-stack engineer working on an Electron + React + Vite desktop application called **Agile Scrum Master**.

**Page:** `(dashboard)/webhooks/page.tsx`
**Route:** `/webhooks`

**Frontend:**

- Webhook management page
- Table of configured webhooks: URL, events subscribed, status (active/inactive), last triggered, success rate
- "Add Webhook" button → modal: URL input, event type checkboxes, secret input, test button
- Per webhook: "Edit", "Delete", "Test" buttons
- Delivery log: per webhook, expandable log of recent deliveries with request/response bodies
- Dead Letter Queue panel: embed `WebhookDLQPanel` component
- "Retry Failed" bulk button

**Backend (IPC):**

- `webhooks:getAll` → returns `Webhook[]`
- `webhooks:create` `{ url, events, secret }` → returns new `Webhook`
- `webhooks:update` `{ webhookId, changes }` → returns updated `Webhook`
- `webhooks:delete` `{ webhookId }` → returns `{ success: boolean }`
- `webhooks:test` `{ webhookId }` → returns `{ success: boolean, responseCode: number }`
- `webhooks:getDeliveryLog` `{ webhookId }` → returns `Delivery[]`
- `webhooks:retryDelivery` `{ deliveryId }` → returns `{ success: boolean }`

---

_End of prompts — 47 total pages covered._
