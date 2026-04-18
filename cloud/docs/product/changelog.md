# Changelog

## [1.0.0] — 2026-03-27

### Added — Agent System
- Task Factory auto-created tasks from GitHub issue and pull request events.
- Auto Assigner scored developers using skill match, workload, and throughput.
- Monitor agent evaluated sprint health and emitted stale-task and risk alerts.
- PR merge-aware automation closed linked tasks after merge confirmation.
- Floating agent bubble surfaced real-time agent status on major dashboard flows.
- Agentic Scrum Master controls centralized policy toggles and agent management.
- Agent decision and run history surfaces were added for operational traceability.

### Added — Core Platform
- Email authentication flows were added for sign-up, sign-in, password reset, and verification.
- Organization onboarding, invitations, and role-aware membership controls were implemented.
- Dashboard experiences were added for sprint health and operational navigation.
- Kanban and board tabs were implemented for summary, backlog, board, code, timeline, pages, and forms views.
- Backlog and task management modules were added with priority, story point, and status controls.
- Sprint planning, sprint lifecycle management, and sprint detail views were implemented.
- Assignment, monitoring, reporting, goals, teams, settings, and profile modules were added.
- Standup capture workflow was added with blocker-aware submission handling.
- In-app documentation hub (`/pages`) and public changelog route were published.

### Added — Integrations
- GitHub OAuth connection, repository visibility, and event ingestion support were implemented.
- GitHub activity tabs were added for overview, commits, pull requests, issues, workflows, and branches.
- Webhook ingestion and dead-letter retry management were added for operational reliability.
- Inngest background function orchestration was integrated for event-driven automation.
- pgvector-backed RAG context operations were added for duplicate checks and context-aware automation.
- AI/ML endpoints were added for risk narration, standup summarization, and planning support.
- Copilot coding agent integration paths were added for task-driven development workflows.

### Added — Data and Intelligence
- Semantic deduplication checks were introduced in task generation to reduce duplicate work.
- Sequential SCRUM code generation logic was implemented for task traceability.
- Capacity, burnout, and alert analytics were added to monitoring views.
- Sprint velocity and risk context pipelines were added to reporting workflows.

### Added — Documentation
- End-user product documentation files were added under `docs/product`.
- Route-linked product guidance was integrated into the in-app pages hub.
- Release communication surface was established through `/changelog`.
