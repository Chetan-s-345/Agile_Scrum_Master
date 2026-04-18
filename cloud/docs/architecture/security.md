# Security Architecture

## Authentication Flow

```text
Browser
  -> POST /api/auth/sign-in (Next.js)
     -> API Gateway /api/v1/auth/login
        -> validate credentials and org context
        -> issue access + refresh token payload
     -> Next.js stores access token in httpOnly auth_token cookie

Subsequent browser API calls
  -> Next.js /app/api/* route handlers
     -> read auth_token cookie server-side
     -> forward bearer token to API Gateway
     -> API Gateway authMiddleware validates JWT_SECRET
```

Key implementation details:
- Gateway enforces bearer token auth in `authMiddleware`.
- Next.js sign-in route sets `auth_token` cookie (`httpOnly`, `sameSite=lax`, `secure` in production, 7-day max-age).
- Refresh token support exists in gateway auth routes (`/api/v1/auth/refresh`) and env policy (`REFRESH_EXPIRES_IN`).

## JWT Structure and Session Strategy

Observed token usage across middleware/routes indicates core claims:
- `userId`
- `orgId`
- `role`

Session strategy:
- Access token verified on each gateway call.
- Refresh flow supported via dedicated endpoint.
- Next.js proxy removes stale cookie when `/auth/me` returns unauthorized.

## Authorization

Authorization is layered:

1) Route-level auth middleware:
- Protected routes require bearer token.

2) Organization data scoping:
- `orgDbMiddleware` resolves `orgId` from JWT and attaches org-specific DB pool.
- Requests fail if org DB is unavailable or schema is incomplete.

3) Role and membership checks:
- Role checks in privileged routes (owner/admin patterns).
- Project-level membership checks for agent operations (`ensureProjectAccess` pattern).
- Team member identity is auto-resolved/ensured per request (`actorMemberId`).

## GitHub Token Storage

GitHub integration tokens are stored in `github_integration.access_token_enc` and retrieved server-side only.

Current behavior:
- The code supports JSON-encoded token payloads and raw string fallback parsing.
- The column naming convention implies encrypted storage intent, but route/service parsing supports both encrypted and plain token representation depending on deployment implementation.

Security recommendation:
- Enforce at-rest encryption before persistence, and remove plain-text fallback once migration is complete.

## Webhook Security

### GitHub webhook verification
- Endpoint: `POST /api/v1/webhooks/github`
- Raw body is preserved with `express.raw()` to prevent body mutation before signature verification.
- Signature: `X-Hub-Signature-256`
- Compare strategy: timing-safe HMAC SHA256 (`timingSafeEqual`).
- Failure behavior: immediate `401 Invalid webhook signature`.

### Jira webhook verification
- Endpoint: `POST /api/v1/webhooks/jira`
- Strategy controlled by `JIRA_WEBHOOK_STRATEGY` (`secret`, `atlassian-token`, `both`).
- Supports secret-based verification and Atlassian token mode.

## SQL Injection Prevention

The codebase consistently uses parameterized SQL (`$1`, `$2`, etc.) through pg/neon clients.

Safe pattern example:
```sql
SELECT id FROM projects WHERE id = $1 LIMIT 1
```

Avoided unsafe pattern:
```sql
SELECT id FROM projects WHERE id = '${projectId}'
```

Because tenant database routing happens before query execution, injection risk is controlled both by parameterization and org-level pool isolation.

## Environment Variable Security

### Secret variables
Treat these as high sensitivity:
- `JWT_SECRET`, `REFRESH_TOKEN_SECRET`
- `UNIVERSAL_DATABASE_URL`, tenant DB connection strings
- `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- `GITHUB_WEBHOOK_SECRET`, `JIRA_WEBHOOK_SECRET`
- `BREVO_API_KEY`
- `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `NEON_API_KEY`

### Rotation guidance
- Rotate auth secrets (`JWT_SECRET`, refresh secret) with coordinated token invalidation windows.
- Rotate webhook secrets and update source providers immediately after rotation.
- Rotate provider API keys quarterly or after incident.
- Use deployment platform secret manager, never repo-tracked files for production values.

### What to never commit
- Real database URLs
- Any API key or webhook secret
- Session/JWT secrets
- Provider private keys or tokens

## Additional Hardening Recommendations

- Add centralized request rate limits for auth and webhook ingress.
- Normalize role enforcement in reusable middleware to reduce route-level omissions.
- Add auditable session revocation logging for logout/refresh abuse analysis.
- Add explicit project membership checks to all task/sprint mutation routes where missing.
- Enforce strict token encryption at rest for all OAuth integrations.