from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.agents.sprint_planning_graph import build_sprint_planning_graph
from app.agents.autogen_sprint_scope import build_handoff_request, run_sprint_scope_conversation
from app.models.sprint_planning import SprintPlanningRequest

router = APIRouter(prefix="/sprint-planning", tags=["sprint-planning"])

_graph = build_sprint_planning_graph()


@router.post("/plan")
def plan_sprint(req: SprintPlanningRequest):
    if not req.developers:
        raise HTTPException(status_code=400, detail="At least one developer is required to produce a fully assigned sprint plan")

    initial_state = {
        "sprint_name": req.sprint_name,
        "backlog_raw": req.backlog,
        "developers_raw": req.developers,
        "constraints": req.constraints,
    }

    out = _graph.invoke(initial_state)
    # finalizer returns {"final_plan": {...}}
    return out.get("final_plan")


@router.post("/scope")
def finalize_scope(req: SprintPlanningRequest):
    if not req.developers:
        raise HTTPException(status_code=400, detail="At least one developer is required to finalize scope")

    scope, transcript = run_sprint_scope_conversation(
        sprint_name=req.sprint_name,
        backlog=req.backlog,
        developers=req.developers,
        constraints=req.constraints,
    )

    handoff = build_handoff_request(req=req, selected_ticket_ids=list(scope.get("selected_ticket_ids", [])))

    return {
        "scope": scope,
        "handoff": handoff.model_dump(),
        "transcript": transcript,
    }
