# Sprint API Documentation

Audience: External developers integrating with Sprint.

Base URLs:
- Development: http://localhost:3000/api
- Gateway upstream (internal): http://localhost:4000/api/v1

Versioning:
- Public app-facing endpoints are exposed under /api/*.
- Most handlers proxy to gateway /api/v1/*.

## Authentication

Sprint uses token-based auth.

1. Call POST /api/auth/sign-in.
2. Use returned token as Bearer token for direct gateway calls, or rely on auth cookie for browser-backed app calls.

Header for direct API calls:
- Authorization: Bearer <token>

## Rate Limiting

Gateway has express-rate-limit support. Effective limits depend on deployment configuration and middleware policy.

## Pagination

List endpoints typically support:
- page: 1-based page index
- limit: page size

Example:
- GET /api/tasks?page=1&limit=20

## Error Format

Most endpoints return JSON errors in one of these forms:
- { "error": "message" }
- { "error": "message", "code": "SOME_CODE", "detail": "details" }

## Quick Start

### 1) Sign in
```bash
curl -X POST http://localhost:3000/api/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"mypassword123"}'
```

### 2) Create project
```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"Platform Revamp","slug":"platform-revamp"}'
```

### 3) Create task
```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"title":"Fix auth redirect","projectId":"<project-id>","priority":"high"}'
```

## API Groups
- Auth: auth.md
- Tasks: tasks.md
- Sprints: sprints.md
- Projects: projects.md
- Developers: developers.md
- Assignment: assignment.md
- Agents: agents.md
- GitHub: github.md
- Webhooks: webhooks.md
- AI: ai.md
- Notifications: notifications.md
