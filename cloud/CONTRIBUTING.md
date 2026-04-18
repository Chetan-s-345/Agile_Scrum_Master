# Contributing to Sprint

## Development Setup
Use the setup in `README.md` first. This file defines contribution workflow and quality expectations.

## Code Style

### TypeScript and React (Next.js app)
- Prefer functional components and hooks.
- Keep route handlers in `app/api/*` thin; move reusable logic into `lib/*` or backend services.
- Preserve existing request/response JSON shapes for backward compatibility.
- Use explicit null/undefined handling for external API payloads.

### Node.js API Gateway
- Keep route files in `backend/api-gateway/src/routes/*` focused on validation and orchestration.
- Put business logic in `backend/api-gateway/src/services/*`.
- Use parameterized SQL only.
- Return consistent error payloads with actionable messages and status codes.

### Python AI Service
- Keep FastAPI endpoints thin and move model or inference logic into `app/services/*`.
- Prefer deterministic defaults and clear fallback paths when external model providers are unavailable.

### Styling and UI
- Follow existing Tailwind patterns and component conventions in `components/*`.
- Do not hardcode auth state assumptions in client components.

## Git Workflow

Branch naming:
- `feature/<ticket-or-scope>`
- `bugfix/<ticket-or-scope>`
- `chore/<scope>`

Commit message format:
- `<scope>: short imperative summary`

Examples:
- `tasks: add time-log validation`
- `agents: persist approval metadata`

Pull request rules:
- Keep PR scope focused and reviewable.
- Include a short test plan in PR description.
- Mention schema changes and migration steps explicitly.
- Add screenshots for visible UI changes.

## Testing

### Root app
- `npm run lint`
- `npm run build`

### API gateway
- `cd backend/api-gateway`
- `npm test`

### AI service
- `cd backend/ai-service`
- run FastAPI smoke checks (at minimum `/health` and changed endpoints)

Write tests for:
- new route handlers and changed route contracts
- service-layer business rules
- agent decision branches that affect assignment or approvals

## Database and Migration Rules
- Treat `backend/api-gateway/init.sql` as source of truth for tenant/universal schemas.
- Use idempotent migrations (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) for upgrades.
- Document schema changes in `docs/technical/database-schema.md` in the same PR.

## Adding a New API Endpoint
1. Add route in `backend/api-gateway/src/routes/*`.
2. Add/extend service in `backend/api-gateway/src/services/*`.
3. Expose BFF proxy route in `app/api/*` if browser-facing.
4. Add validation and auth checks.
5. Add tests and update technical docs.

## Adding a New Agent Capability
1. Implement function in `inngest/functions/*`.
2. Export from `inngest/functions/index.ts`.
3. Register in `app/api/inngest/route.ts`.
4. Add policy/config fields if needed with safe defaults.
5. Update `docs/technical/agents.md` and include test/replay instructions.

## Security Requirements
- Never commit secrets or tokens.
- Keep JWT/org checks intact for protected routes.
- Preserve webhook signature verification paths.
- Minimize data exposure in logs, especially auth and payment fields.

## Documentation Requirements
For non-trivial behavior changes, update:
- `README.md`
- `docs/technical/architecture.md`
- `docs/technical/database-schema.md` (if schema affected)
- `docs/technical/agents.md` (if automation or events affected)
