"""
GitNexus FastAPI Routes
Serves repository analysis to frontend
"""

import json
import logging
import os
from typing import AsyncGenerator

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


@router.post("/analyze")
async def analyze_repo(request: AnalyzeRequest):
    """Analyze repository and stream progress."""
    
    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            github_token = os.getenv("GITHUB_TOKEN", "")
            
            # Run sandbox analysis
            async for event in sandbox_manager.run_analysis(
                repo_url=request.repo_url,
                github_token=github_token,
                branch=request.branch,
                since_days=request.since_days,
                resource_tier=request.resource_tier,
                ram_mb=request.ram_mb,
            ):
                if event["type"] == "error":
                    yield f'data: {json.dumps({"event": "error", "data": {"message": event["error"], "detail": event.get("detail")}})}\n\n'
                    return
                
                if event["type"] == "progress":
                    yield f'data: {json.dumps({"event": "progress", "data": event["line"]})}\n\n'
                
                elif event["type"] == "complete":
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
                    
                    # Map to sprint tasks
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

                        mapped = await mapper.map_to_sprint(
                            nexus_result=nexus_result,
                            project_id=request.project_id,
                        )
                        
                        yield f'data: {json.dumps({"event": "complete", "data": mapped})}\n\n'
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
