# Getting Started with Sprint

## What is Sprint?
Sprint is an AI-powered Agentic Scrum Manager that helps engineering teams run projects with less manual coordination. Instead of moving tickets between tools by hand, chasing owners, and constantly checking if work is on track, Sprint automates the repetitive parts of Scrum execution across planning, assignment, monitoring, and reporting.

Sprint is for Scrum Masters, engineering managers, product managers, developers, and operations teams who want reliable delivery without heavy process overhead. It connects to your delivery systems, understands sprint context, and continuously assists with task creation, assignment, risk detection, and team communication.

## Key Concepts
- Project: A workspace-scoped delivery container that groups your backlog, tasks, sprints, developers, metrics, and integrations.
- Sprint: A time-boxed execution window with a defined goal, planned scope, and measurable progress indicators (velocity, burndown, risk).
- Task: A trackable work item with fields such as title, status, assignee, priority, and story points. Tasks can be created manually or automatically.
- Backlog: The prioritized queue of work not yet completed. Backlog items can be promoted into active sprints.
- Story Points: Relative effort estimates used to plan capacity and forecast sprint throughput.
- Agent: An automation worker that runs operational workflows such as task generation, assignment, and monitoring.
- Scrum Master: The role responsible for sprint health, process quality, and blocker removal, supported by Sprint agents and analytics.

## Step-by-Step First Setup
### Step 1: Create your account
[Screenshot: Sign up page]
1. Open `/auth/sign-up`.
2. Enter your name, email, and password, then complete sign-up.
3. Verify your email if prompted.
4. Sign in at `/auth/sign-in`.

### Step 2: Create your first project
[Screenshot: Project creation flow]
1. Open `/dashboard`.
2. Click create project.
3. Enter project name, optional key, and initial settings.
4. Save to create the project shell and default backlog context.

### Step 3: Connect your GitHub repository
[Screenshot: GitHub integration page]
1. Open `/github` or `/settings/integrations`.
2. Start GitHub OAuth and authorize access.
3. Select organization/repository to connect.
4. Confirm webhook setup and sync permissions.

### Step 4: Import your GitHub issues as tasks
[Screenshot: GitHub issues import]
1. In `/github`, open the `Issues` tab.
2. Choose issues to import or run project-level ingest.
3. Sprint creates task records from issue metadata.
4. Deduplication runs first; likely duplicate tasks are skipped.
5. Imported tasks appear in `/backlog` and `/tasks`.

### Step 5: Set up your first sprint
[Screenshot: Sprint planning page]
1. Open `/sprint-plan` or `/sprints`.
2. Create a sprint with name, goal, start date, and end date.
3. Move selected backlog tasks into the sprint.
4. Start the sprint when scope is finalized.

### Step 6: Enable the agents
[Screenshot: Agentic Scrum Master page]
1. Open `/scrum-master`.
2. Select your project.
3. Enable automation policy for issue ingestion, PR ingestion, auto-assignment, and monitoring.
4. Verify each core agent is active: Task Factory, Auto Assigner, and Monitor.

### Step 7: Invite your team
[Screenshot: Team settings page]
1. Open `/settings/team`.
2. Send invitations by email.
3. Set role permissions.
4. Add developer skills and capacity details for better assignment quality.

## What Happens Automatically After Setup
- New GitHub issues are converted into tasks when ingestion is enabled.
- Tasks are assigned to the best-fit developer based on skills, workload, and throughput scoring.
- Sprint health is monitored on schedule, with alerts for stale tasks, overload, and velocity risk.
- Pull requests linked to task references can update and close matching tasks after merge.
- Standup submissions are processed automatically, and blocker-related tasks are generated from detected blockers.
- Standup summaries are compiled on the morning cadence (for example, 9:30 AM) and shared with the team.
