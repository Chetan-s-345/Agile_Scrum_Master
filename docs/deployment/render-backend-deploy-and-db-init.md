# Render Backend Deploy + Contributor DB Init

## What was added

- Multi-service Render blueprint:
  - render.yaml
- Contributor DB init script:
  - backend/api-gateway/scripts/init-contributor-db.js
- NPM helper script:
  - backend/api-gateway/package.json -> init:contributor-db

## Backend services configured for Render

The Render blueprint defines:

1. asm-api-gateway (Node)

- rootDir: backend/api-gateway
- buildCommand: npm ci
- startCommand: npm start
- healthCheckPath: /health

2. asm-ai-service (Python/FastAPI)

- rootDir: backend/ai-service
- buildCommand: pip install -r requirements.txt
- startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
- healthCheckPath: /health

3. asm-redis (Redis)

- Used by gateway background workers/scheduler.

## Render deploy steps

1. Push code to GitHub.
2. In Render, create a new Blueprint and point to the repo.
3. Render will detect render.yaml and provision all services.
4. Fill required secret env vars in Render dashboard:

- asm-api-gateway:
  - FRONTEND_URL
  - UNIVERSAL_DATABASE_URL
  - JWT_SECRET
  - REFRESH_TOKEN_SECRET
  - optional integration keys (Jira/Groq/OpenAI/etc)
- asm-ai-service:
  - DATABASE_URL (optional but recommended for ML persistence)
  - GROQ_API_KEY (if using Groq routes)

## Contributor DB initialization

This project includes one script to initialize contributor databases from backend/api-gateway/init.sql.

It initializes:

- Universal schema (always, from UNIVERSAL_DATABASE_URL)
- Tenant schema (optional, if TENANT_DB_CONNECTION_STRING is present)

### Required env vars

- UNIVERSAL_DATABASE_URL=postgresql://...

Optional:

- TENANT_DB_CONNECTION_STRING=postgresql://...

### Run command

From backend/api-gateway:

npm run init:contributor-db

### Behavior

- If TENANT_DB_CONNECTION_STRING is set:
  - universal + tenant schemas are initialized.
- If TENANT_DB_CONNECTION_STRING is not set:
  - universal schema initializes;
  - tenant init is skipped with a clear message.

## Notes

- AI service can run without DATABASE_URL, but ML persistence tables are not available.
- For production, use strong secrets and do not commit real keys in any .env file.
