"""
GitNexus FastAPI Routes
Serves repository analysis to frontend
"""

import base64
import json
import logging
import os
import time
from typing import AsyncGenerator
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..mapper import NexusMapper
from ..sandbox import NexusSandboxManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/git-nexus", tags=["git-nexus"])

sandbox_manager = NexusSandboxManager()


class AnalyzeRequest(BaseModel):
    repo_url: str
    project_id: str
    branch: str = ""
    since_days: int = 30
    resource_tier: str = ""
    ram_mb: int | None = None


class TaskImportRequest(BaseModel):
    tasks: list
    project_id: str


class CreatePrRequest(BaseModel):
    repo: str
    project_id: str
    file_path: str | None = None
    title: str | None = None
    body: str | None = None


def normalize_github_repo_input(repo_value: str) -> str:
    """Normalize GitHub repo inputs to an owner/repo slug."""
    cleaned = repo_value.strip().rstrip("/")
    if cleaned.endswith(".git"):
        cleaned = cleaned[:-4]

    if cleaned.startswith("git@github.com:"):
        path = cleaned.removeprefix("git@github.com:")
    else:
        parsed = urlparse(cleaned)
        if parsed.scheme in {"http", "https"} and parsed.netloc.endswith("github.com"):
            path = parsed.path.strip("/")
        else:
            path = cleaned

    parts = [segment for segment in path.split("/") if segment]
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail="repo must be in owner/repo format")

    return f"{parts[0]}/{parts[1]}"


@router.post("/analyze")
async def analyze_repo(request: AnalyzeRequest):
    """Analyze repository and stream progress."""

    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            github_token = os.getenv("GITHUB_TOKEN", "")

            async for event in sandbox_manager.run_analysis(
                repo_url=request.repo_url,
                github_token=github_token,
                branch=request.branch,
                since_days=request.since_days,
                resource_tier=request.resource_tier,
                ram_mb=request.ram_mb,
            ):
                event_type = event.get("type")

                if event_type == "error":
                    yield f'data: {json.dumps({"event": "error", "data": {"message": event["error"], "detail": event.get("detail")}})}\n\n'
                    return

                if event_type == "progress":
                    yield f'data: {json.dumps({"event": "progress", "data": event.get("line", "")})}\n\n'
                    continue

                if event_type != "complete":
                    continue

                nexus_result = event["result"]["result"]
                config_used = event["result"].get("config_used", {})
                nexus_result["sandbox_config"] = {
                    "tier_name": config_used.get("tier_name", ""),
                    "ram_mb": config_used.get("ram_mb", 0),
                    "cpu": config_used.get("cpu", 0),
                    "timeout_seconds": config_used.get("timeout_seconds", 0),
                    "duration_seconds": event["result"].get("duration_seconds", 0),
                    "override_applied": config_used.get("override_applied", False),
                }

                db_url = os.getenv("DATABASE_URL", "")
                if not db_url:
                    yield f'data: {json.dumps({"event": "complete", "data": nexus_result})}\n\n'
                    return

                mapper = NexusMapper(db_url)
                try:
                    await mapper.connect()
                    if not mapper.pool:
                        logger.warning("Database unavailable, returning raw GitNexus result")
                        yield f'data: {json.dumps({"event": "complete", "data": nexus_result})}\n\n'
                        return

                    try:
                        await mapper.save_analysis(nexus_result, request.project_id, request.repo_url)
                    except Exception as e:
                        logger.warning(f"Failed to persist analysis: {e}")

                    mapped = await mapper.map_to_sprint(
                        nexus_result=nexus_result,
                        project_id=request.project_id,
                    )
                    # mapped already has structure {"event": "complete", "data": payload, "stats": {...}}
                    # Extract just the data payload for the SSE event
                    yield f'data: {json.dumps({"event": "complete", "data": mapped.get("data", nexus_result)})}\n\n'
                except Exception as e:
                    logger.error(f"Mapping error: {e}")
                    yield f'data: {json.dumps({"event": "error", "data": {"message": str(e)[:200], "detail": None}})}\n\n'
                finally:
                    await mapper.disconnect()

        except Exception as e:
            logger.error(f"Analysis error: {e}")
            yield f'data: {json.dumps({"event": "error", "data": {"message": str(e)[:200], "detail": None}})}\n\n'

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/status")
async def get_status():
    """Get sandbox status."""
    return sandbox_manager.get_sandbox_status()


@router.get("/last")
async def get_last(project_id: str):
    """Return most recent saved nexus analysis for project_id."""
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        return {"error": "Database not configured"}

    mapper = NexusMapper(db_url)
    try:
        await mapper.connect()
        if not mapper.pool:
            return {"error": "Database unavailable"}

        async with mapper.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT raw_payload FROM app.nexus_analyses WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1",
                project_id,
            )

        if not row:
            return {"error": "Not found"}

        return row["raw_payload"]
    except Exception as e:
        logger.error(f"Fetch last analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e)[:200])
    finally:
        await mapper.disconnect()


@router.post("/create-pr")
async def create_pr(request: CreatePrRequest):
    """Create a PR in the target repo containing the current analysis JSON."""
    token = os.getenv("GITHUB_TOKEN", "")
    if not token:
        raise HTTPException(status_code=400, detail="GITHUB_TOKEN not configured on server")

    owner_repo = normalize_github_repo_input(request.repo)
    owner, repo = owner_repo.split("/", 1)
    file_path = request.file_path or f"git-nexus-analysis-{request.project_id}.json"

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        raise HTTPException(status_code=400, detail="Database not configured")

    mapper = NexusMapper(db_url)
    try:
        await mapper.connect()
        if not mapper.pool:
            raise HTTPException(status_code=500, detail="Database unavailable")

        async with mapper.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT raw_payload FROM app.nexus_analyses WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1",
                request.project_id,
            )

        if not row:
            raise HTTPException(status_code=404, detail="No analysis found for project")

        content_json = json.dumps(row["raw_payload"], indent=2)

        async with httpx.AsyncClient() as client:
            headers = {
                "Authorization": f"token {token}",
                "Accept": "application/vnd.github.v3+json",
            }

            repo_resp = await client.get(f"https://api.github.com/repos/{owner}/{repo}", headers=headers)
            if repo_resp.status_code != 200:
                raise HTTPException(status_code=400, detail="Failed to access target repository")

            default_branch = repo_resp.json().get("default_branch", "main")
            ref_resp = await client.get(
                f"https://api.github.com/repos/{owner}/{repo}/git/ref/heads/{default_branch}",
                headers=headers,
            )
            if ref_resp.status_code != 200:
                raise HTTPException(status_code=400, detail="Failed to resolve default branch")

            base_sha = ref_resp.json()["object"]["sha"]
            branch_name = f"gitnexus/{request.project_id}-{int(time.time())}"

            create_ref_resp = await client.post(
                f"https://api.github.com/repos/{owner}/{repo}/git/refs",
                headers=headers,
                json={"ref": f"refs/heads/{branch_name}", "sha": base_sha},
            )
            if create_ref_resp.status_code not in (200, 201):
                raise HTTPException(status_code=400, detail="Failed to create branch on target repo")

            put_resp = await client.put(
                f"https://api.github.com/repos/{owner}/{repo}/contents/{file_path}",
                headers=headers,
                json={
                    "message": request.title or f"Add GitNexus analysis for {request.project_id}",
                    "content": base64.b64encode(content_json.encode("utf8")).decode("utf8"),
                    "branch": branch_name,
                },
            )
            if put_resp.status_code not in (200, 201):
                raise HTTPException(status_code=400, detail="Failed to create file in repo")

            pr_resp = await client.post(
                f"https://api.github.com/repos/{owner}/{repo}/pulls",
                headers=headers,
                json={
                    "title": request.title or f"GitNexus analysis: {request.project_id}",
                    "head": branch_name,
                    "base": default_branch,
                    "body": request.body or "Adds GitNexus analysis JSON",
                },
            )
            if pr_resp.status_code not in (200, 201):
                raise HTTPException(status_code=400, detail="Failed to create pull request")

            return pr_resp.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create PR error: {e}")
        raise HTTPException(status_code=500, detail=str(e)[:200])
    finally:
        await mapper.disconnect()


@router.get("/tasks")
async def get_tasks(project_id: str):
    """Get cached tasks for project."""
    try:
        db_url = os.getenv("DATABASE_URL", "")
        if not db_url:
            return {"tasks": []}

        mapper = NexusMapper(db_url)
        await mapper.connect()

        if not mapper.pool:
            return {"tasks": []}

        # TODO: Fetch from app.nexus_analyses table
        tasks = []

        await mapper.disconnect()
        return {"tasks": tasks}
    except Exception as e:
        logger.error(f"Fetch tasks error: {e}")
        raise HTTPException(status_code=500, detail=str(e)[:200])


@router.post("/import-tasks")
async def import_tasks(request: TaskImportRequest):
    """Bulk import tasks to sprint."""
    try:
        # TODO: Implement database insertion
        return {
            "imported": len(request.tasks),
            "failed": 0,
            "errors": [],
        }
    except Exception as e:
        logger.error(f"Import error: {e}")
        raise HTTPException(status_code=500, detail=str(e)[:200])
