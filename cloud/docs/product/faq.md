# FAQ

## Getting Started (5)

### 1. How do I invite team members?
Open `/settings/team`, add member emails, assign roles, and send invites. New members can join through invite links and then be mapped into project workflows.

### 2. Can I use Sprint without GitHub?
Yes. You can create projects, tasks, sprints, and reports manually. GitHub integration adds automation depth but is not required for basic Scrum operation.

### 3. How many projects can I create?
Project limits depend on your plan and workspace policy. If you hit a limit, check `/settings/billing` for plan details and upgrade options.

### 4. Can I import from Jira?
Yes, Jira support exists in the platform integration stack and related tooling. Configure Jira mapping in integration settings before running sync/import operations.

### 5. How do I delete a project?
Open the project settings or project management controls and use the delete/archive action with required confirmation. Use archive first when you need retention without active execution.

## Tasks (8)

### 6. Why was a task assigned to the wrong person?
Auto Assigner uses skill, load, and throughput signals, so missing or outdated developer data can skew outcomes. Update developer skills/capacity and rerun assignment or override manually.

### 7. How do I change task priority?
Open the task in `/tasks` or `/backlog`, edit the priority field, and save. Priority changes immediately affect planning and monitoring interpretation.

### 8. What is a story point?
Story points are relative effort units used for planning and capacity balancing. They estimate complexity/effort, not exact hours.

### 9. Can I create sub-tasks?
Yes, task workflows support hierarchical and linked task structures where enabled. Use task detail actions to add child items or links.

### 10. How do I link two tasks?
Use task linking actions in the task detail or related task controls. Linked tasks help monitoring and dependency tracking understand execution impact.

### 11. What does "stale" mean on a task?
A stale task has had insufficient movement or updates within expected time windows. Monitoring raises stale alerts so teams can re-engage or reassign work.

### 12. Why was my task auto-closed?
Tasks can be auto-closed when linked PR merge workflows confirm completion criteria. Verify PR-task linkage and merge automation settings.

### 13. How do I log time on a task?
Use task detail time logging controls where available in your environment. If your workspace does not expose time logs yet, use comments/updates until enabled.

## Agents (8)

### 14. How do I turn off automatic assignment?
Open `/scrum-master` and disable auto-assignment in the automation policy for the selected project. You can still assign tasks manually from `/assignment` or task views.

### 15. Can I pause an agent?
Yes. In `/scrum-master`, set an agent status to paused or disable relevant automation toggles.

### 16. Why did the agent skip assigning a task?
Common reasons are low assignment confidence, missing developer profiles, restricted policy settings, or unavailable eligible assignees.

### 17. How does the agent know my developers' skills?
It reads developer profile and skill metadata maintained in team/developer records, then blends it with workload and throughput context.

### 18. How often do agents run?
Runs are event-driven plus scheduled pulses. Monitoring is scheduled and task/assignment operations can also trigger from incoming integration events.

### 19. Can I trigger an agent manually?
Yes. Trigger actions are available on automation and assignment surfaces for immediate execution.

### 20. What happens when an agent fails?
Failures are logged and surfaced through monitoring/agent views. You can inspect logs, fix configuration issues, and rerun the workflow.

### 21. How do I update developer skills?
Edit developer/team profiles and update skill tags/capacity inputs. Assignment quality improves as these fields become more accurate.

## GitHub (5)

### 22. How do I connect my GitHub repository?
Go to `/github` or integration settings, complete OAuth, pick the repository, and confirm webhook/sync access.

### 23. Does it work with private repos?
Yes, if the authorized GitHub installation/token has permission to access the private repository.

### 24. What GitHub events does Sprint listen to?
At minimum, issue and pull request lifecycle events plus related repository activity needed for mapping, status updates, and automation triggers.

### 25. How do I use the Copilot coding agent?
Use task-level develop/send-to-agent actions and the agent workflows that package task context for coding assistance.

### 26. What is AGENTS.md?
It is a repository instruction file used to define coding-agent behavior and workflow constraints for automated assistance.

## Billing and Account (4)

### 27. How do I change my plan?
Open `/settings/billing`, review available plans, and apply the new tier. Changes take effect based on your billing policy.

### 28. Can I export my data?
Export options depend on your plan and enabled endpoints. Use reporting and data export controls, or request support if self-serve export is not enabled.

### 29. How do I cancel?
Open billing settings and follow the cancellation flow. Confirm retention and access timelines before final confirmation.

### 30. Is my data secure?
Sprint uses authenticated access, role-aware controls, and tenant-scoped data handling. Security posture also depends on your workspace configuration and integration permissions.
