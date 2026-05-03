from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from app.models.sprint_planning import (
    BacklogTicketIn,
    DeveloperProfileIn,
    SprintPlanningConstraints,
    SprintPlanningRequest,
)
from app.services.autogen_llm import build_groq_llm_config


def _require_autogen():
    try:
        # pyautogen (0.2.x)
        from autogen import AssistantAgent, GroupChat, GroupChatManager, UserProxyAgent  # type: ignore

        return AssistantAgent, GroupChat, GroupChatManager, UserProxyAgent
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "AutoGen is not installed or incompatible. Install 'pyautogen' in the ai-service environment."
        ) from exc


def _ticket_brief(t: BacklogTicketIn) -> Dict[str, Any]:
    return {
        "id": t.id,
        "title": t.title,
        "story_points": t.story_points,
        "priority": t.priority,
        "labels": t.labels,
        "required_skills": t.required_skills,
        "has_acceptance_criteria": bool(
            t.description and re.search(r"acceptance\s*criteria", t.description, flags=re.I)
        ),
    }


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


_FINAL_JSON_RE = re.compile(r"FINAL_SCOPE_JSON\s*:\s*(\{.*\})\s*$", re.S)


def _extract_final_json(text: str) -> Optional[Dict[str, Any]]:
    m = _FINAL_JSON_RE.search(text.strip())
    if not m:
        # Try to find a fenced JSON block.
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


def _fallback_scope(*, backlog: List[BacklogTicketIn], developers: List[DeveloperProfileIn], constraints: SprintPlanningConstraints) -> Dict[str, Any]:
    if not backlog:
        return {
            "selected_ticket_ids": [],
            "dropped_ticket_ids": [],
            "qa_flags": {"missing_acceptance_criteria": []},
            "notes": "No backlog items were provided.",
        }

    capacities = [float(d.sprint_capacity_points if d.sprint_capacity_points is not None else 40.0) for d in developers]
    current_loads = [float(d.current_load_points if d.current_load_points is not None else 0.0) for d in developers]
    remaining_capacity = sum(max(0.0, cap - load) for cap, load in zip(capacities, current_loads)) if developers else 0.0
    selected: List[str] = []
    selected_points = 0.0
    missing_ac: List[str] = []

    for ticket in backlog:
        points = float(ticket.story_points or 3)
        has_ac = bool(ticket.description and re.search(r"acceptance\s*criteria", ticket.description, flags=re.I))
        if not has_ac:
            missing_ac.append(ticket.id)
        if remaining_capacity > 0 and selected_points + points > remaining_capacity * 1.05:
            continue
        selected.append(ticket.id)
        selected_points += points

    if not selected:
        selected.append(backlog[0].id)

    return {
        "selected_ticket_ids": selected,
        "dropped_ticket_ids": [ticket.id for ticket in backlog if ticket.id not in set(selected)],
        "qa_flags": {"missing_acceptance_criteria": missing_ac},
        "notes": "Deterministic fallback scope was used because conversational planning was unavailable.",
    }


def run_sprint_scope_conversation(
    *,
    sprint_name: str,
    backlog: List[BacklogTicketIn],
    developers: List[DeveloperProfileIn],
    constraints: SprintPlanningConstraints,
    max_rounds: int = 10,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Run an AutoGen GroupChat to finalize sprint scope.

    Returns:
      - scope_result: dict containing selected_ticket_ids, dropped_ticket_ids, qa_flags, notes
      - transcript: list of messages (role/name/content where available)
    """

    use_autogen = os.getenv("SPRINT_PLANNER_USE_AUTOGEN", "").strip().lower() in {"1", "true", "yes", "on"}
    if not use_autogen:
        scope = _fallback_scope(backlog=backlog, developers=developers, constraints=constraints)
        transcript = [
            {
                "name": "System",
                "role": "system",
                "content": "Deterministic sprint scope used because SPRINT_PLANNER_USE_AUTOGEN is disabled.",
            }
        ]
        return scope, transcript

    try:
        AssistantAgent, GroupChat, GroupChatManager, UserProxyAgent = _require_autogen()
        llm_config = build_groq_llm_config(temperature=0.2)

        scrum_master = AssistantAgent(
            name="ScrumMasterAgent",
            llm_config=llm_config,
            system_message=(
                "You are the ScrumMasterAgent. Orchestrate sprint planning. "
                "Enforce Scrum rules: prioritize delivering value, respect capacity, "
                "keep scope realistic, and resolve conflicts. "
                "You must produce a final sprint scope that can be handed off to an optimizer. "
                "At the end, output ONLY one line starting with 'FINAL_SCOPE_JSON:' followed by valid JSON. "
                "JSON schema: {selected_ticket_ids: string[], dropped_ticket_ids: string[], qa_flags: {missing_acceptance_criteria: string[]}, notes: string}."
            ),
        )

        product_owner = AssistantAgent(
        name="ProductOwnerAgent",
        llm_config=llm_config,
        system_message=(
            "You are the ProductOwnerAgent. Prioritize backlog based on impact/urgency. "
            "Ask for clarifications only when needed. Provide concise answers. "
            "Propose a shortlist of tickets for this sprint and justify tradeoffs."
        ),
    )

        qa_agent = AssistantAgent(
        name="QAAgent",
        llm_config=llm_config,
        system_message=(
            "You are the QAAgent. Flag tickets missing acceptance criteria or testability. "
            "Return ticket ids that lack acceptance criteria or are ambiguous."
        ),
    )

        developer_agents = []
        for d in developers:
            developer_agents.append(
                AssistantAgent(
                    name=f"DeveloperAgent_{d.id}",
                    llm_config=llm_config,
                    system_message=(
                        "You are a DeveloperAgent representing a team member. "
                        "Report capacity and blockers. Provide skill fit commentary. "
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

        messages_payload = {
            "sprint_name": sprint_name,
            "constraints": constraints.model_dump(),
            "developers": [_developer_brief(d) for d in developers],
            "backlog": [_ticket_brief(t) for t in backlog],
        }

        kickoff = (
            "We are doing sprint planning. Use the provided JSON context. "
            "Steps: PO proposes top candidates; QA flags missing AC; developers report capacity/blockers; "
            "ScrumMaster finalizes scope.\n\n"
            f"CONTEXT_JSON:\n{json.dumps(messages_payload, ensure_ascii=False)}"
        )

        participants = [user, scrum_master, product_owner, qa_agent, *developer_agents]
        group_chat = GroupChat(agents=participants, messages=[], max_round=max_rounds)
        manager = GroupChatManager(groupchat=group_chat, llm_config=llm_config)

        user.initiate_chat(manager, message=kickoff)

        transcript = []
        for m in group_chat.messages:
            transcript.append(
                {
                    "name": m.get("name"),
                    "role": m.get("role"),
                    "content": m.get("content"),
                }
            )

        scope_json: Optional[Dict[str, Any]] = None
        for m in reversed(group_chat.messages):
            if m.get("name") == "ScrumMasterAgent" and isinstance(m.get("content"), str):
                scope_json = _extract_final_json(m["content"])
                if scope_json:
                    break

        if not scope_json:
            scope_json = _fallback_scope(backlog=backlog, developers=developers, constraints=constraints)

        scope_json.setdefault("selected_ticket_ids", [])
        scope_json.setdefault("dropped_ticket_ids", [])
        scope_json.setdefault("qa_flags", {"missing_acceptance_criteria": []})
        scope_json.setdefault("notes", "")

        return scope_json, transcript
    except Exception as exc:
        return _fallback_scope(backlog=backlog, developers=developers, constraints=constraints), [
            {
                "name": "System",
                "role": "system",
                "content": f"Fallback sprint scope used because conversational planning was unavailable: {exc}",
            }
        ]


def build_handoff_request(
    *,
    req: SprintPlanningRequest,
    selected_ticket_ids: List[str],
) -> SprintPlanningRequest:
    selected = [t for t in req.backlog if t.id in set(selected_ticket_ids)]
    return SprintPlanningRequest(
        sprint_name=req.sprint_name,
        backlog=selected,
        developers=req.developers,
        constraints=req.constraints,
    )
