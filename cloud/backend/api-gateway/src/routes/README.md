# API Routes

This folder contains Express route modules mounted in backend/api-gateway/src/app.js under /api/v1/*.

## Organization
- One route file per domain (auth, tasks, sprints, projects, assignment, integrations, agents, monitoring, etc.).
- Routes should remain thin: validate inputs, enforce middleware, delegate business logic to services/controllers.

## Middleware Pattern
Common route protection pattern:
- authMiddleware: validates JWT bearer token.
- orgDbMiddleware: resolves tenant DB connection and actor context.

Typical usage:
- public auth endpoints apply no auth middleware.
- org-scoped endpoints apply both authMiddleware and orgDbMiddleware.

## Error Response Format
Prefer stable JSON errors:
- { "error": "message" }
- optionally with code/details for operational diagnostics.

## Adding a New Route
1. Create or update a file in this folder.
2. Wire it in backend/api-gateway/src/app.js under /api/v1/<group>.
3. Apply middleware consistently with existing group behavior.
4. Implement controller/service logic outside route layer.
5. Add/update tests and API docs.
