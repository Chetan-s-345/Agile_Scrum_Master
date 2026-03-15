from __future__ import annotations

import json
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from app.models.agentic_sprint import AgenticSprintGeneratedTicket
from app.models.sprint_planning import DeveloperProfileIn, SprintPlanningConstraints
from app.services.autogen_llm import build_groq_llm_config


def _require_autogen():
    try:
        from autogen import AssistantAgent, GroupChat, GroupChatManager, UserProxyAgent  # type: ignore

        return AssistantAgent, GroupChat, GroupChatManager, UserProxyAgent
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "AutoGen is not installed or incompatible. Install 'pyautogen' in the ai-service environment."
        ) from exc


_FINAL_JSON_RE = re.compile(r"FINAL_BACKLOG_JSON\s*:\s*(\{.*\})\s*$", re.S)


def _extract_final_json(text: str) -> Optional[Dict[str, Any]]:
    m = _FINAL_JSON_RE.search(text.strip())
    if not m:
        fence = re.search(r"```json\s*(\{.*?\})\s*```", text, flags=re.S | re.I)
        if fence:
            try:
                return json.loads(fence.group(1))
            except Exception:
                return None
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _developer_brief(d: DeveloperProfileIn) -> Dict[str, Any]:
    return {
        "id": d.id,
        "name": d.name,
        "tech_stack": d.tech_stack,
        "merit_score": d.merit_score,
        "recent_velocity": d.recent_velocity,
        "current_load_points": d.current_load_points,
        "sprint_capacity_points": d.sprint_capacity_points,
    }


def run_project_bootstrap_conversation(
    *,
    sprint_name: str,
    project_details: str,
    developers: List[DeveloperProfileIn],
    constraints: SprintPlanningConstraints,
    max_tickets: int,
    max_rounds: int = 10,
) -> Tuple[List[AgenticSprintGeneratedTicket], List[int], str | None, List[Dict[str, Any]]]:
    """Use AutoGen GroupChat to generate a backlog from project details and pick scope.

    Returns:
      - generated tickets
      - selected indices
      - sprint goal (optional)
      - transcript
    """

    AssistantAgent, GroupChat, GroupChatManager, UserProxyAgent = _require_autogen()

    llm_config = build_groq_llm_config(temperature=0.2)

    scrum_master = AssistantAgent(
        name="ScrumMasterAgent",
        llm_config=llm_config,
        system_message=(
            "You are the ScrumMasterAgent. Run an agentic sprint bootstrap from a project brief. "
            "Enforce Scrum: realistic scope, capacity awareness, testability, and value delivery. "
            "Work with ProductOwner, QA, and Developer agents. "
            "At the end, output ONLY one line starting with 'FINAL_BACKLOG_JSON:' followed by valid JSON. "
            "JSON schema: {\n"
            "  sprint_goal: string,\n"
            "  tickets: [{title:string, description:string, story_points:int, priority:'P0'|'P1'|'P2'|'P3', required_skills:string[], labels:string[]}],\n"
            "  selected_ticket_indices: int[],\n"
            "  notes: string\n"
            "}.\n"
            "Requirements: tickets must be concrete, testable, and sized 1..13 story points (Fibonacci). "
            "Keep total selected story points within team capacity unless allow_over_capacity is true."
        ),
    )

    product_owner = AssistantAgent(
        name="ProductOwnerAgent",
        llm_config=llm_config,
        system_message=(
            "You are the ProductOwnerAgent. Translate project details into a prioritized list of sprint tickets. "
            "Prefer high-value deliverables and clear acceptance criteria. Keep it concise."
        ),
    )

    qa_agent = AssistantAgent(
        name="QAAgent",
        llm_config=llm_config,
        system_message=(
            "You are the QAAgent. Ensure tickets are testable and have acceptance criteria embedded in descriptions. "
            "Flag missing AC and propose exact AC bullets."
        ),
    )

    developer_agents = []
    for d in developers:
        developer_agents.append(
            AssistantAgent(
                name=f"DeveloperAgent_{d.id}",
                llm_config=llm_config,
                system_message=(
                    "You are a DeveloperAgent. Provide feasibility notes and skill fit for proposed tickets. "
                    f"Developer profile JSON: {json.dumps(_developer_brief(d), ensure_ascii=False)}"
                ),
            )
        )

    user = UserProxyAgent(
        name="System",
        human_input_mode="NEVER",
        max_consecutive_auto_reply=0,
        code_execution_config=False,
    )

    # Estimate team capacity in points (best-effort)
    team_capacity = 0.0
    for d in developers:
        cap = float(d.sprint_capacity_points if d.sprint_capacity_points is not None else 40.0)
        load = float(d.current_load_points if d.current_load_points is not None else 0.0)
        team_capacity += max(0.0, cap - load)

    context_json = {
        "sprint_name": sprint_name,
        "project_details": project_details,
        "constraints": constraints.model_dump(),
        "team_capacity_points_estimate": team_capacity,
        "max_tickets": int(max_tickets),
        "developers": [_developer_brief(d) for d in developers],
    }

    kickoff = (
        "Bootstrap a sprint from project details. "
        "Produce up to max_tickets tickets and select a realistic subset for this sprint. "
        "Each ticket description MUST include acceptance criteria bullets.\n\n"
        f"CONTEXT_JSON:\n{json.dumps(context_json, ensure_ascii=False)}"
    )

    participants = [user, scrum_master, product_owner, qa_agent, *developer_agents]
    group_chat = GroupChat(agents=participants, messages=[], max_round=max_rounds)
    manager = GroupChatManager(groupchat=group_chat, llm_config=llm_config)

    user.initiate_chat(manager, message=kickoff)

    transcript: List[Dict[str, Any]] = []
    for m in group_chat.messages:
        transcript.append({"name": m.get("name"), "role": m.get("role"), "content": m.get("content")})

    final_json: Optional[Dict[str, Any]] = None
    for m in reversed(group_chat.messages):
        if m.get("name") == "ScrumMasterAgent" and isinstance(m.get("content"), str):
            final_json = _extract_final_json(m["content"])
            if final_json:
                break

    if not final_json:
        return [], [], None, transcript

    raw_tickets = final_json.get("tickets") or []
    selected = final_json.get("selected_ticket_indices") or []
    sprint_goal = final_json.get("sprint_goal")

    tickets: List[AgenticSprintGeneratedTicket] = []
    for t in raw_tickets:
        try:
            tickets.append(AgenticSprintGeneratedTicket.model_validate(t))
        except Exception:
            # Skip invalid items
            continue

    selected_indices: List[int] = []
    for i in selected:
        try:
            ii = int(i)
        except Exception:
            continue
        if 0 <= ii < len(tickets):
            selected_indices.append(ii)

    # De-dupe preserving order
    seen = set()
    selected_indices = [i for i in selected_indices if not (i in seen or seen.add(i))]

    return tickets, selected_indices, str(sprint_goal) if sprint_goal else None, transcript


def stable_ticket_id(title: str) -> str:
    # Deterministic-ish id for matching within a single request (not global uniqueness guaranteed)
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"agentic-ticket:{title}"))
