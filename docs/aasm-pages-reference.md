# Pages Reference

---

### Login Page

**Route:** `/login`  
**Tab/Section:** Auth  
**Purpose:** Authenticates users with GitHub OAuth or credentials.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| LoginForm | Email and password form |
| GitHubOAuthButton | GitHub sign-in button |
| AuthErrorBanner | Login error message |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| POST | /api/auth/[...nextauth] | on sign in submit |

**User Actions:**

- Enter credentials -> sign in -> POST /api/auth/[...nextauth]
- Click GitHub sign in -> OAuth flow -> POST /api/auth/[...nextauth]

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Monitor | auth.fail event | shows auth status note |

**Real-time Updates:** no — no polling or websocket

---

### Register / Workspace Setup

**Route:** `/register`  
**Tab/Section:** Auth  
**Purpose:** Creates a workspace and optional starter project.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| WorkspaceSetupForm | Name, slug, and plan fields |
| ProjectQuickStart | Optional project fields |
| SetupProgress | Setup status steps |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| POST | /api/workspaces | on workspace create |
| POST | /api/projects | on project create |

**User Actions:**

- Enter workspace data -> create workspace -> POST /api/workspaces
- Add starter project -> create project -> POST /api/projects

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Task Gen | project.created | seeds first task hints |

**Real-time Updates:** no — no polling or websocket

---

### Dashboard

**Route:** `/dashboard`  
**Tab/Section:** Main App  
**Purpose:** Shows sprint health, alerts, and agent activity.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| SprintHealthCards | Sprint KPI summary cards |
| AlertsBanner | Open alert summary bar |
| AgentActivityFeed | Recent agent run list |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| GET | /api/workspaces | on page load |
| GET | /api/alerts/[projectId] | on page load and refresh |
| GET | /api/projects/[id]/agents/status | on page load and refresh |

**User Actions:**

- Select workspace -> load scoped data -> GET /api/workspaces
- Open alert details -> navigate monitor -> GET /api/alerts/[projectId]

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Monitor | alert.triggered | alert counts increase |
| Task Gen | task.created | activity feed adds event |
| Auto Assign | task.assigned | activity feed adds event |

**Real-time Updates:** yes — polling every 60s

---

### Sprint Board

**Route:** `/[workspace]/[project]/board`  
**Tab/Section:** Main App  
**Purpose:** Manages sprint tasks in kanban columns.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| BoardTabs | Sprint and view tabs |
| KanbanBoard | Drag-drop task columns |
| TaskDetailDrawer | Task detail side panel |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| GET | /api/sprints/[id]/tasks | on page load |
| PATCH | /api/tasks/[id] | on card move/edit |

**User Actions:**

- Drag task card -> update status -> PATCH /api/tasks/[id]
- Open task drawer -> edit details -> PATCH /api/tasks/[id]

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Auto Assign | task.created | assignee badge appears |
| Monitor | task.updated | blocker flags update |

**Real-time Updates:** yes — polling every 30s

---

### Backlog

**Route:** `/[workspace]/[project]/backlog`  
**Tab/Section:** Main App  
**Purpose:** Manages all tasks with filters and bulk actions.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| BacklogTable | Task rows and columns |
| FilterBar | Type, priority, sprint filters |
| CreateTaskModal | New task form dialog |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| GET | /api/projects/[id]/sprints | on page load |
| POST | /api/tasks | on create task |
| PATCH | /api/tasks/[id] | on update task |
| DELETE | /api/tasks/[id] | on delete task |

**User Actions:**

- Create task -> add backlog item -> POST /api/tasks
- Bulk assign sprint -> update tasks -> PATCH /api/tasks/[id]
- Delete selected task -> remove item -> DELETE /api/tasks/[id]

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Task Gen | github.push | new backlog rows appear |
| Auto Assign | task.created | assignee column updates |

**Real-time Updates:** yes — polling every 60s

---

### Agentic Scrum Master Page

**Route:** `/[workspace]/[project]/agents`  
**Tab/Section:** Main App  
**Purpose:** Controls agents, logs, and event pipeline state.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| AgentCard | Agent status and trigger controls |
| LogPanel | Run logs with level filters |
| InngestPipeline | Event pipeline visual map |
| LiveFeed | Event timeline stream |
| TeamLoadGrid | Team load matrix |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| GET | /api/projects/[id]/agents/status | on page load and refresh |
| POST | /api/agents/task-gen/trigger | on trigger click |
| POST | /api/agents/auto-assign/trigger | on trigger click |
| POST | /api/agents/monitor/trigger | on trigger click |
| GET | /api/agents/[id]/logs | on logs open |
| GET | /api/team/[projectId] | on load grid open |

**User Actions:**

- Trigger task agent -> enqueue run -> POST /api/agents/task-gen/trigger
- Trigger assign agent -> enqueue run -> POST /api/agents/auto-assign/trigger
- Trigger monitor agent -> enqueue run -> POST /api/agents/monitor/trigger
- Filter logs -> fetch page -> GET /api/agents/[id]/logs

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Task Gen | github.push | run status turns RUNNING |
| Auto Assign | task.created | assignment logs stream |
| Monitor | task.updated | alert events stream |

**Real-time Updates:** yes — polling every 10s

---

### GitHub Integration Page

**Route:** `/[workspace]/[project]/github`  
**Tab/Section:** Main App  
**Purpose:** Shows repo links, webhook health, and event mapping.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| ConnectedReposPanel | Linked repository cards |
| WebhookStatus | Webhook health badge |
| EventsTable | Recent GitHub event rows |
| MappingHistory | Event to task mapping list |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| GET | /api/github/events/[projectId] | on page load and refresh |

**User Actions:**

- Refresh events -> pull latest rows -> GET /api/github/events/[projectId]
- Open mapping row -> inspect linkage -> no API write

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Task Gen | github.\* events | mapping rows show task ids |

**Real-time Updates:** yes — polling every 30s

---

### Monitoring Page

**Route:** `/[workspace]/[project]/monitor`  
**Tab/Section:** Main App  
**Purpose:** Tracks blockers, SLA risk, and reassignment history.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| AlertsList | Active and resolved alerts |
| BlockerPanel | Blocked task details |
| SLATracker | SLA breach timeline |
| ReassignHistory | Assignment change log |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| GET | /api/alerts/[projectId] | on page load and refresh |
| PATCH | /api/alerts/[id]/resolve | on resolve click |

**User Actions:**

- Resolve alert -> mark resolved -> PATCH /api/alerts/[id]/resolve
- Open task from alert -> navigate board -> GET /api/sprints/[id]/tasks

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Monitor | scheduledSweep | new alerts appear |
| Auto Assign | sla breach flow | reassignment rows appear |

**Real-time Updates:** yes — polling every 15s

---

### Team Page

**Route:** `/[workspace]/[project]/team`  
**Tab/Section:** Main App  
**Purpose:** Displays workload, skills, and performance by developer.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| TeamGrid | Developer profile cards |
| WorkloadBars | Capacity and load bars |
| SkillsEditor | Editable skill tags |
| PerformancePanel | Score and trend stats |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| GET | /api/team/[projectId] | on page load and refresh |
| PATCH | /api/team/[memberId]/skills | on skills save |

**User Actions:**

- Edit skills -> save updates -> PATCH /api/team/[memberId]/skills
- Review load -> inspect profile -> GET /api/team/[projectId]

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Auto Assign | task.assigned | load bars update |
| Monitor | overload alert | warning badges appear |

**Real-time Updates:** yes — polling every 30s

---

### Analytics Page

**Route:** `/[workspace]/[project]/analytics`  
**Tab/Section:** Main App  
**Purpose:** Shows delivery metrics and agent ROI trends.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| BurndownChart | Remaining work over time |
| VelocityChart | Completed points per sprint |
| CycleTimePanel | Avg cycle time metrics |
| AgentRoiCards | Automation impact stats |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| GET | /api/analytics/[projectId] | on page load and range change |

**User Actions:**

- Change date range -> reload metrics -> GET /api/analytics/[projectId]
- Compare sprints -> redraw charts -> GET /api/analytics/[projectId]

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Monitor | sprint.completed | velocity data updates |
| Task Gen | task.created | ROI counters increase |

**Real-time Updates:** yes — polling every 300s

---

### Workspace Settings

**Route:** `/[workspace]/settings`  
**Tab/Section:** Settings  
**Purpose:** Manages workspace members, billing, and general config.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| MembersTable | Workspace member list |
| BillingPanel | Plan and billing details |
| WorkspaceConfigForm | Name and defaults form |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| GET | /api/workspaces | on page load |

**User Actions:**

- Update workspace settings -> save config -> PATCH internal settings route
- Review members -> refresh list -> GET /api/workspaces

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Monitor | workspace alert summary | status badge updates |

**Real-time Updates:** no — manual refresh only

---

### Project Settings

**Route:** `/[workspace]/[project]/settings`  
**Tab/Section:** Settings  
**Purpose:** Configures project agents, GitHub, RAG, and rules.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| AgentConfigForm | Per-agent toggles and limits |
| GitHubConfigPanel | Repo and install settings |
| RagConfigPanel | RAG thresholds and options |
| AutoAssignRules | Assignment rule editor |
| InngestWebhookInfo | Webhook URL and status |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| GET | /api/projects/[id]/agents/status | on page load |
| POST | /api/projects | on project config save |

**User Actions:**

- Toggle agent options -> save config -> POST /api/projects
- Check pipeline status -> refresh state -> GET /api/projects/[id]/agents/status

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Task Gen | config change | generation behavior changes |
| Auto Assign | rule change | scoring behavior changes |
| Monitor | threshold change | alert behavior changes |

**Real-time Updates:** yes — polling every 60s

---

### Admin Dashboard

**Route:** `/admin`  
**Tab/Section:** Admin  
**Purpose:** Shows platform metrics, errors, and agent health.

**Components Used:**
| Component | What it renders |
|-----------|-----------------|
| PlatformMetricCards | Global KPI summaries |
| AgentHealthTable | Agent error and latency stats |
| ErrorRateChart | Error trend timeline |
| ActiveWorkspaceList | Online workspace table |

**API Calls:**
| Method | Endpoint | When Called |
|--------|----------|-------------|
| GET | /api/projects/[id]/agents/status | on page load and refresh |
| GET | /api/workspaces | on page load |

**User Actions:**

- Filter health table -> reload data -> GET /api/projects/[id]/agents/status
- Open workspace details -> inspect tenant -> GET /api/workspaces

**Agent Interaction:**
| Agent | Trigger | Effect on this page |
|-------|---------|---------------------|
| Task Gen | run failure | error rate increases |
| Auto Assign | run failure | health row turns warning |
| Monitor | run failure | health row turns critical |

**Real-time Updates:** yes — polling every 60s

---
