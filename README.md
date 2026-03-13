# Automated Agile Sprint Manager

An automation-first toolkit for Scrum teams to plan, track, and optimize sprints with minimal manual effort.

## What It Does

- Creates sprint plans from prioritized backlog items
- Auto-assigns work using team capacity and skill tags
- Tracks sprint progress (velocity, burndown, blockers)
- Generates standup updates and end-of-sprint reports
- Syncs project data with Jira for a single source of truth

## Core Features

### 1) Sprint Planning Automation
- Pulls top-priority Jira backlog items
- Suggests sprint scope based on velocity and capacity
- Flags risks (dependency chains, overloaded team members)

### 2) Daily Scrum Support
- Produces team standup summaries:
  - Yesterday completed
  - Today planned
  - Blockers
- Highlights issue status changes and idle tickets

### 3) Sprint Health Monitoring
- Burndown and velocity tracking
- WIP limit alerts
- Scope-change detection during active sprint

### 4) Retrospective Insights
- Compares planned vs delivered points
- Identifies recurring blockers
- Suggests actionable improvements for next sprint

## Jira Integration

This project is designed to integrate directly with Jira Cloud using REST APIs.

### Prerequisites

- Jira Cloud site (example: `https://your-domain.atlassian.net`)
- Jira API token
- Jira account email
- Access to the target Jira project and board

### Environment Variables

Create a `.env` file:

```env
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=your_api_token
JIRA_PROJECT_KEY=ENG
JIRA_BOARD_ID=12
JIRA_SPRINT_NAME=Sprint 24
```

### Recommended Jira API Endpoints

- Get backlog/issues:
  - `GET /rest/agile/1.0/board/{boardId}/backlog`
- Create sprint:
  - `POST /rest/agile/1.0/sprint`
- Add issues to sprint:
  - `POST /rest/agile/1.0/sprint/{sprintId}/issue`
- Update issue status:
  - `POST /rest/api/3/issue/{issueIdOrKey}/transitions`
- Read sprint report data:
  - `GET /rest/agile/1.0/board/{boardId}/sprint/{sprintId}/issue`

### Authentication

Use Basic Auth with email + API token:

- Username: Jira account email
- Password: Jira API token

### Integration Workflow

1. Fetch prioritized backlog items from Jira board
2. Estimate sprint capacity from team availability + velocity
3. Select issues for sprint scope recommendation
4. Create sprint in Jira (or select active sprint)
5. Push selected issues to sprint
6. Continuously sync status updates and blockers
7. Generate sprint dashboard + retrospective summary

## Suggested Project Structure

```text
/automation
  /jira
    client.py
    sprint_service.py
  /planning
    capacity.py
    scope_optimizer.py
  /reporting
    standup.py
    retrospective.py
README.md
```

## Quick Start

1. Add Jira credentials to `.env`
2. Connect to your Jira board
3. Pull backlog and run sprint plan generation
4. Sync selected issues into current sprint
5. Run daily report generation

## Security Notes

- Never commit `.env` with real tokens
- Rotate Jira API tokens regularly
- Use least-privilege Jira permissions

## Roadmap

- Team-specific capacity calibration
- AI-based risk prediction for sprint scope
- Slack/Teams standup bot integration
- Multi-board portfolio sprint reporting

## License

See [LICENSE](LICENSE).
