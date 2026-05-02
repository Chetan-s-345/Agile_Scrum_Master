# git-nexus-runtime (E2B template)

This folder contains the Dockerfile and an E2B `Template` definition plus a build
script to publish the template to E2B.

Prerequisites

- Node.js (recommended) and `npm`/`npx`
- `E2B_API_KEY` environment variable set (see https://e2b.dev/docs/api-key)
- `npm i e2b dotenv` (or use `npx` / `tsx` to run the build script)

Build (development)

```bash
cd cloud/backend/ai-service/templates/git-nexus-runtime
npx tsx build.ts
```

This will build and upload the template to E2B under the alias `gitnexus-runtime`.

Usage

```js
import "dotenv/config";
import { Sandbox } from "e2b";

const sbx = await Sandbox.create("gitnexus-runtime");
const result = await sbx.commands.run("gitnexus --version");
console.log(result.stdout);
await sbx.kill();
```

Notes

- The template is created by parsing the included `Dockerfile` so keep it in sync.
- Adjust `cpuCount`/`memoryMB` in `build.ts` if your template needs more resources during build.

# GitNexus E2B Runtime Template

Enterprise-grade E2B sandbox template for GitHub repository analysis following SecDev patterns.

## Architecture

```
Template (Dockerfile)
    ↓
E2B Registry (agile-gitnexus-runtime)
    ↓
NexusSandboxManager (Python async orchestrator)
    ↓
FastAPI Routes (/api/v1/git-nexus/*)
    ↓
Client (SSE stream)
```

## Files

- **Dockerfile**: Python 3.11 slim base with git, curl, wget, gitpython pre-installed
- **e2b.toml**: Template metadata (name, ID, dockerfile path, env vars)
- **start.sh**: Entry script for manual sandbox testing
- **deployer.py**: Build and push template to E2B registry

## Building Locally

```bash
cd templates/git-nexus-runtime/

# Validate files
python3 deployer.py --validate

# Build Docker image locally
python3 deployer.py --build-only

# Test image
docker run --rm -it agile-gitnexus-runtime bash
```

## Pushing to E2B

```bash
# Set API key
export E2B_API_KEY=<your_e2b_api_key>

# Build and push to E2B registry
python3 deployer.py --push

# Verify template in E2B
python3 deployer.py --verify
```

Output:

```
✅ Template pushed to E2B
   Template ID: agile-gitnexus

NEXT STEPS:
1️⃣  Add to .env:
   E2B_TEMPLATE=agile-gitnexus-runtime
   E2B_TEMPLATE_ID=agile-gitnexus
```

## Integration with AI Service

**1. Environment (.env):**

```bash
E2B_API_KEY=<your_e2b_api_key>
E2B_TEMPLATE=agile-gitnexus-runtime
E2B_TEMPLATE_ID=agile-gitnexus
GITHUB_TOKEN=<your_github_token>
DATABASE_URL=postgresql://...
```

**2. Wire router (main.py):**

```python
from git_nexus.routes import router as git_nexus_router

# ... FastAPI setup ...
app.include_router(git_nexus_router, prefix="/api/v1")
```

**3. Test endpoint:**

```bash
curl -X POST http://localhost:8000/api/v1/git-nexus/analyze \
  -H 'Content-Type: application/json' \
  -d '{
    "repo_url": "https://github.com/owner/repo",
    "project_id": "project-123",
    "branch": "main",
    "since_days": 30
  }'
```

## Resource Allocation

Template automatically scales based on repo size:

| Tier   | Size      | RAM   | CPU | Timeout |
| ------ | --------- | ----- | --- | ------- |
| tiny   | <10MB     | 512MB | 0.5 | 120s    |
| small  | 10-100MB  | 1GB   | 1.0 | 240s    |
| medium | 100-500MB | 2GB   | 2.0 | 480s    |
| large  | >500MB    | 4GB   | 4.0 | 900s    |

Overrides are supported for heavy repositories:

- Environment override: `GITNEXUS_RESOURCE_TIER=tiny|small|medium|large`
- Environment override: `GITNEXUS_RAM_MB=<512..8192>`
- Request override fields on `/api/v1/git-nexus/analyze`:
  - `resource_tier`: `tiny|small|medium|large`
  - `ram_mb`: integer MB

If an override is out of bounds, the service clamps it to a safe range.

## Deep Scan Coverage

The analyzer now returns additional payload for deep repository inspection:

- `project_structure.all_dirs`: recursive directories (bounded)
- `project_structure.all_files`: recursive files (bounded)
- `symbol_inventory`: function/class/interface inventory per file and totals

This data is emitted in the same SSE completion payload and is rendered in the frontend details panel.

## Error Handling

- **404**: Repository not found (check URL)
- **403**: Rate limit or permission denied (check GitHub token)
- **>2GB**: Repository too large (E2B limit)
- **Timeout**: Analysis exceeded time limit

## Development

### Manual Testing

```bash
# Clone and analyze locally
git clone https://github.com/owner/repo repo
python3 analyzer.py \
  --repo-url https://github.com/owner/repo \
  --branch main \
  --since-days 30 \
  --token $GITHUB_TOKEN
```

### Build Custom Image

```bash
# Modify Dockerfile for additional packages
docker build -t agile-gitnexus-runtime:custom .

# Push to Docker Hub
docker tag agile-gitnexus-runtime:custom username/gitnexus:latest
docker push username/gitnexus:latest
```

## Troubleshooting

| Issue                 | Solution                                |
| --------------------- | --------------------------------------- |
| E2B CLI not installed | `npm install -g @e2b/cli`               |
| Docker not running    | `docker daemon start` or `podman start` |
| API key invalid       | Check `E2B_API_KEY` and E2B dashboard   |
| GitHub token expired  | Generate new personal access token      |
| Sandbox timeout       | Reduce `since_days` or use larger tier  |

## References

- [E2B Documentation](https://e2b.dev/docs)
- [SecDev E2B Deep Dive](../../../docs/LIVEKIT_DEEPGRAM_MIGRATION.md)
- [GitNexus Architecture](../git_nexus/README.md)
