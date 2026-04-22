# Inngest Event Reference

## sprint/created

Fired by: app/api/sprints/route.ts (after sprint creation)
Consumed by: sprint-created-groq-brief
Payload:

```json
{
  "orgId": "string",
  "projectId": "string",
  "sprintId": "string",
  "sprintName": "string"
}
```

Side effects: Generates sprint brief content via Groq.

## github/issue.opened

Fired by: webhook/integration pipelines
Consumed by: githubIssueToTask
Payload:

```json
{
  "orgId": "string",
  "projectId": "string",
  "issueNumber": 123,
  "title": "string",
  "body": "string",
  "labels": ["string"],
  "repoFullName": "owner/repo"
}
```

Side effects: Deduplicates, creates task, may emit task/created.

## github/pr.opened

Fired by: webhook/integration pipelines
Consumed by: prToTask
Payload:

```json
{
  "orgId": "string",
  "projectId": "string",
  "prNumber": 42,
  "title": "string",
  "body": "string",
  "branchName": "feature/x",
  "repoFullName": "owner/repo"
}
```

Side effects: Creates/enriches task context for PR activity.

## github/push

Fired by: webhook/integration pipelines
Consumed by: githubPushToTask
Payload:

```json
{
  "orgId": "string",
  "projectId": "string",
  "repoFullName": "owner/repo",
  "commits": [{ "id": "sha", "message": "string" }]
}
```

Side effects: May create follow-up tasks from actionable commits.

## task/created

Fired by: task-factory emitTaskCreated helper
Consumed by: taskCreatedAutoAssign
Payload:

```json
{
  "orgId": "string",
  "projectId": "string",
  "taskId": "string"
}
```

Side effects: Assignment candidate scoring and assignee update.

## task/updated

Fired by: task update flows
Consumed by: taskUpdatedMonitoring
Payload:

```json
{
  "orgId": "string",
  "projectId": "string",
  "taskId": "string",
  "status": "string",
  "changedFields": ["string"]
}
```

Side effects: Monitoring pulse decisions and risk checks.

## agent/custom.run

Fired by: manual/custom agent command paths
Consumed by: customAgentRunObserved
Payload:

```json
{
  "orgId": "string",
  "projectId": "string",
  "agentName": "string",
  "input": {}
}
```

Side effects: Records custom run metadata and action log entries.

## github/pr.merged

Fired by: webhook/integration pipelines
Consumed by: prMergedToDone
Payload:

```json
{
  "orgId": "string",
  "projectId": "string",
  "prNumber": 42,
  "branchName": "feature/x"
}
```

Side effects: Marks linked tasks done and records automation action.

## sprint/ending.tomorrow

Fired by: scheduled monitoring/cron flow
Consumed by: sprintEndCleanupEvent
Payload:

```json
{
  "orgId": "string",
  "projectId": "string",
  "sprintId": "string"
}
```

Side effects: Sprint end cleanup tasks and carry-over handling.

## meeting/completed

Fired by: API gateway meeting completion workflow (status update + Daily webhook)
Consumed by: meetingCompletedObserved
Payload:

```json
{
  "orgId": "string|null",
  "projectId": "string|null",
  "sprintId": "string|null",
  "meetingId": "string",
  "meetingType": "string|null",
  "title": "string|null",
  "source": "meeting-status-update|daily-webhook"
}
```

Side effects: Records agent action trail for completed meetings and feeds observability.

## meeting/task.created

Fired by: API gateway post-meeting automation job after creating tasks
Consumed by: meetingTaskCreatedObserved
Payload:

```json
{
  "orgId": "string",
  "projectId": "string",
  "sprintId": "string",
  "meetingId": "string",
  "taskId": "string",
  "title": "string",
  "assigneeId": "string",
  "priority": "critical|high|medium|low",
  "storyPoints": 3
}
```

Side effects: Records meeting-generated task events for agentic Scrum Master traceability.

## meeting/automation.started

Fired by: API gateway post-meeting automation job at start
Consumed by: none (observability event)

## meeting/automation.completed

Fired by: API gateway post-meeting automation job on completion
Consumed by: none (observability event)
