from __future__ import annotations

from typing import List

from app.agents.autogen_project_bootstrap import run_project_bootstrap_conversation, stable_ticket_id
from app.agents.sprint_planning_graph import build_sprint_planning_graph
from app.models.agentic_sprint import AgenticSprintBuildRequest, AgenticSprintBuildResponse, AgenticSprintGeneratedTicket
from app.models.sprint_planning import BacklogTicketIn


def _as_backlog_ticket(ticket: AgenticSprintGeneratedTicket) -> BacklogTicketIn:
    return BacklogTicketIn(
        id=stable_ticket_id(ticket.title),
        title=ticket.title,
        description=ticket.description,
        story_points=ticket.story_points,
        priority=ticket.priority,
        required_skills=ticket.required_skills,
        labels=ticket.labels,
    )


async def build_agentic_sprint(*, req: AgenticSprintBuildRequest) -> AgenticSprintBuildResponse:
    generated, selected_indices, sprint_goal, transcript = run_project_bootstrap_conversation(
        sprint_name=req.sprint_name,
        project_details=req.project_details,
        developers=req.developers,
        constraints=req.constraints,
        max_tickets=req.max_tickets,
    )

    selected_ids: List[str] = []
    selected_backlog: List[BacklogTicketIn] = []
    for idx in selected_indices:
        t = generated[idx]
        bt = _as_backlog_ticket(t)
        selected_ids.append(bt.id)
        selected_backlog.append(bt)

    graph = build_sprint_planning_graph()
    initial_state = {
        "sprint_name": req.sprint_name,
        "backlog_raw": selected_backlog,
        "developers_raw": req.developers,
        "constraints": req.constraints,
    }
    out = graph.invoke(initial_state)
    final_plan = out.get("final_plan")

    return AgenticSprintBuildResponse(
        sprint_name=req.sprint_name,
        sprint_goal=sprint_goal,
        generated_tickets=[{**t.model_dump(), "id": stable_ticket_id(t.title)} for t in generated],
        selected_ticket_ids=selected_ids,
        final_plan=final_plan,
        transcript=transcript,
    )
