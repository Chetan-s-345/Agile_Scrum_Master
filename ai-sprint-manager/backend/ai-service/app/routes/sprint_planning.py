from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.agents.sprint_planning_graph import build_sprint_planning_graph
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
