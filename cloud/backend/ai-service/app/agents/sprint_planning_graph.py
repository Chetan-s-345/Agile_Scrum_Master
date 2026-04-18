from __future__ import annotations

import math
import re
from datetime import date
from typing import Any, Dict, List, Literal, Optional, Set, Tuple, TypedDict

from langgraph.graph import END, StateGraph

from app.models.sprint_planning import (
    BacklogTicketIn,
    DeveloperProfileIn,
    DeveloperScore,
    RiskItem,
    SprintPlanningConstraints,
    SprintPlanOut,
    TicketAnalysis,
    TicketAssignment,
)


class PlanningState(TypedDict, total=False):
    sprint_name: str
    backlog_raw: List[BacklogTicketIn]
    developers_raw: List[DeveloperProfileIn]
    constraints: SprintPlanningConstraints

    ticket_analysis: List[TicketAnalysis]
    developer_scores: List[DeveloperScore]

    assignments: List[TicketAssignment]
    risks: List[RiskItem]


Priority = Literal["P0", "P1", "P2", "P3"]


_PRIORITY_DEFAULT: Priority = "P2"


def _norm_skill(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def _norm_label(s: str) -> str:
    return re.sub(r"[^a-z0-9+.#-]+", "-", s.strip().lower()).strip("-")


def _priority_to_weight(p: Priority) -> float:
    return {"P0": 1.4, "P1": 1.2, "P2": 1.0, "P3": 0.85}[p]


def _infer_priority(ticket: BacklogTicketIn) -> Priority:
    if ticket.priority in ("P0", "P1", "P2", "P3"):
        return ticket.priority

    joined = " ".join([ticket.title, ticket.description or "", " ".join(ticket.labels)]).lower()
    if any(k in joined for k in ["blocker", "urgent", "p0", "sev0", "security"]):
        return "P0"
    if any(k in joined for k in ["p1", "sev1", "high"]):
        return "P1"
    if any(k in joined for k in ["p3", "nice to have", "low"]):
        return "P3"
    return _PRIORITY_DEFAULT


def _infer_complexity_points(ticket: BacklogTicketIn) -> int:
    if isinstance(ticket.story_points, int) and ticket.story_points > 0:
        return ticket.story_points

    text = f"{ticket.title}\n{ticket.description or ''}".lower()
    # crude heuristics
    if any(k in text for k in ["spike", "research", "investigate"]):
        return 3
    if any(k in text for k in ["refactor", "migration", "schema", "auth", "integrat"]):
        return 8
    if any(k in text for k in ["bug", "fix", "typo", "copy"]):
        return 2
    # fallback
    return 5


def _infer_required_skills(ticket: BacklogTicketIn) -> List[str]:
    # Prefer explicit required_skills if provided.
    skills = [_norm_skill(s) for s in (ticket.required_skills or []) if _norm_skill(s)]

    # Add normalized labels as weak skills.
    for l in ticket.labels:
        nl = _norm_label(l)
        if nl:
            skills.append(nl)

    # Extract some common tech terms.
    text = f"{ticket.title} {ticket.description or ''}".lower()
    for term in [
        "next.js",
        "nextjs",
        "react",
        "typescript",
        "postgres",
        "sql",
        "neon",
        "redis",
        "inngest",
        "jira",
        "oauth",
        "nextauth",
        "fastapi",
        "python",
    ]:
        if term in text:
            skills.append(_norm_label(term))

    # De-dupe preserving order.
    seen: Set[str] = set()
    out: List[str] = []
    for s in skills:
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def backlog_analyzer_agent(state: PlanningState) -> PlanningState:
    backlog = state.get("backlog_raw", [])
    analysis: List[TicketAnalysis] = []

    for t in backlog:
        prio = _infer_priority(t)
        complexity = _infer_complexity_points(t)
        skills = _infer_required_skills(t)
        analysis.append(
            TicketAnalysis(
                ticket_id=t.id,
                complexity_points=int(complexity),
                priority=prio,
                required_skills=skills,
            )
        )

    return {"ticket_analysis": analysis}


def developer_profile_agent(state: PlanningState) -> PlanningState:
    devs = state.get("developers_raw", [])

    scores: List[DeveloperScore] = []
    for d in devs:
        merit = float(d.merit_score if d.merit_score is not None else 50.0)
        velocity = float(d.recent_velocity if d.recent_velocity is not None else 0.75)
        load = float(d.current_load_points if d.current_load_points is not None else 0.0)
        cap = float(d.sprint_capacity_points if d.sprint_capacity_points is not None else 40.0)

        # Components are normalized to roughly 0..1
        merit_component = max(0.0, min(1.0, merit / 100.0))
        velocity_component = max(0.0, min(1.0, velocity))
        load_component = max(0.0, min(1.0, 1.0 - (load / max(cap, 1.0))))
        skill_component = 0.5  # computed per ticket; baseline

        # Base score without ticket specifics.
        base = 0.45 * merit_component + 0.25 * velocity_component + 0.30 * load_component
        scores.append(
            DeveloperScore(
                developer_id=d.id,
                score=base,
                merit_component=merit_component,
                velocity_component=velocity_component,
                skill_component=skill_component,
                load_component=load_component,
            )
        )

    return {"developer_scores": scores}


def _skills_overlap(required: List[str], tech_stack: List[str]) -> Tuple[float, List[str]]:
    req = {_norm_label(s) for s in required if s}
    tech = {_norm_label(s) for s in tech_stack if s}
    if not req:
        return 0.6, []  # neutral

    inter = sorted(req.intersection(tech))
    overlap = len(inter) / max(1, len(req))
    # Map overlap from 0..1 into 0.2..1 to avoid hard zeros.
    return 0.2 + 0.8 * overlap, inter


def assignment_optimizer_agent(state: PlanningState) -> PlanningState:
    tickets = state.get("ticket_analysis", [])
    backlog_raw = {t.id: t for t in state.get("backlog_raw", [])}
    devs = {d.id: d for d in state.get("developers_raw", [])}
    base_scores = {s.developer_id: s for s in state.get("developer_scores", [])}
    constraints = state.get("constraints", SprintPlanningConstraints())

    # Capacity bookkeeping
    remaining_capacity: Dict[str, float] = {}
    for dev_id, d in devs.items():
        cap = float(d.sprint_capacity_points if d.sprint_capacity_points is not None else 40.0)
        load = float(d.current_load_points if d.current_load_points is not None else 0.0)
        remaining_capacity[dev_id] = cap - load

    def ticket_rank_key(t: TicketAnalysis) -> float:
        return -(_priority_to_weight(t.priority) * t.complexity_points)

    sorted_tickets = sorted(tickets, key=ticket_rank_key)

    assignments: List[TicketAssignment] = []

    for t in sorted_tickets:
        best: Optional[Tuple[str, float, float, str]] = None
        second_best_score: Optional[float] = None

        for dev_id, d in devs.items():
            base = base_scores.get(dev_id)
            base_score = float(base.score if base else 0.5)

            skill_score, matched = _skills_overlap(t.required_skills, d.tech_stack)

            cap_left = remaining_capacity.get(dev_id, 0.0)
            overload = max(0.0, (t.complexity_points - cap_left))
            overload_penalty = 0.08 * overload

            total = (0.55 * base_score) + (0.45 * skill_score) - overload_penalty
            total *= _priority_to_weight(t.priority)

            if best is None or total > best[1]:
                if best is not None:
                    second_best_score = best[1] if second_best_score is None else max(second_best_score, best[1])
                rationale = (
                    f"base={base_score:.2f}, skill={skill_score:.2f}"
                    + (f", matched={matched}" if matched else "")
                    + (f", overload_penalty={overload_penalty:.2f}" if overload_penalty > 0 else "")
                )
                best = (dev_id, total, skill_score, rationale)
            else:
                second_best_score = total if second_best_score is None else max(second_best_score, total)

        if best is None:
            continue

        chosen_id, chosen_score, _, rationale = best

        # If over capacity and not allowed, pick the best dev who can fit.
        if not constraints.allow_over_capacity:
            fitting: List[Tuple[str, float, str]] = []
            for dev_id, d in devs.items():
                if remaining_capacity.get(dev_id, 0.0) >= t.complexity_points:
                    base = base_scores.get(dev_id)
                    base_score = float(base.score if base else 0.5)
                    skill_score, matched = _skills_overlap(t.required_skills, d.tech_stack)
                    total = (0.55 * base_score) + (0.45 * skill_score)
                    total *= _priority_to_weight(t.priority)
                    fitting.append((dev_id, total, f"base={base_score:.2f}, skill={skill_score:.2f}, matched={matched}"))
            if fitting:
                chosen_id, chosen_score, rationale = sorted(fitting, key=lambda x: x[1], reverse=True)[0]

        # Update capacity
        remaining_capacity[chosen_id] = remaining_capacity.get(chosen_id, 0.0) - float(t.complexity_points)

        # Confidence: margin vs second best, squashed to 0..1.
        margin = chosen_score - (second_best_score if second_best_score is not None else (chosen_score - 0.01))
        confidence = 1.0 / (1.0 + math.exp(-6.0 * margin))
        confidence = float(max(0.05, min(0.98, confidence)))

        ticket_title = backlog_raw.get(t.ticket_id).title if t.ticket_id in backlog_raw else t.ticket_id
        assignments.append(
            TicketAssignment(
                ticket_id=t.ticket_id,
                developer_id=chosen_id,
                confidence=confidence,
                score=float(chosen_score),
                rationale=f"{ticket_title}: {rationale}",
            )
        )

    return {"assignments": assignments}


def _days_between(start: Optional[date], end: Optional[date]) -> Optional[int]:
    if not start or not end:
        return None
    return max(0, (end - start).days)


def risk_assessor_agent(state: PlanningState) -> PlanningState:
    tickets = state.get("ticket_analysis", [])
    devs = state.get("developers_raw", [])
    assignments = state.get("assignments", [])
    constraints = state.get("constraints", SprintPlanningConstraints())

    risks: List[RiskItem] = []

    # Skill single point of failure
    skill_to_devs: Dict[str, Set[str]] = {}
    for d in devs:
        for s in d.tech_stack:
            skill_to_devs.setdefault(_norm_label(s), set()).add(d.id)

    for t in tickets:
        for rs in t.required_skills:
            k = _norm_label(rs)
            devset = skill_to_devs.get(k, set())
            if len(devset) == 0:
                risks.append(
                    RiskItem(
                        category="missing-skill",
                        severity="high",
                        message=f"No developer appears to have required skill '{k}' for ticket {t.ticket_id}.",
                        details={"ticket_id": t.ticket_id, "skill": k},
                    )
                )
            elif len(devset) == 1:
                risks.append(
                    RiskItem(
                        category="single-point-of-failure",
                        severity="medium",
                        message=f"Only one developer has skill '{k}' needed for ticket {t.ticket_id}.",
                        details={"ticket_id": t.ticket_id, "skill": k, "developer_ids": sorted(devset)},
                    )
                )

    # Load risk (over capacity)
    dev_load_delta: Dict[str, float] = {}
    ticket_points = {t.ticket_id: float(t.complexity_points) for t in tickets}
    for a in assignments:
        dev_load_delta[a.developer_id] = dev_load_delta.get(a.developer_id, 0.0) + ticket_points.get(a.ticket_id, 0.0)

    for d in devs:
        cap = float(d.sprint_capacity_points if d.sprint_capacity_points is not None else 40.0)
        current = float(d.current_load_points if d.current_load_points is not None else 0.0)
        planned = dev_load_delta.get(d.id, 0.0)
        total = current + planned
        if total > cap:
            risks.append(
                RiskItem(
                    category="over-capacity",
                    severity="high" if total > cap * 1.2 else "medium",
                    message=f"Developer {d.name} planned load {total:.1f} exceeds capacity {cap:.1f}.",
                    details={"developer_id": d.id, "planned_total": total, "capacity": cap},
                )
            )

    # Deadline risk
    total_points = sum(ticket_points.values())
    total_capacity = 0.0
    for d in devs:
        cap = float(d.sprint_capacity_points if d.sprint_capacity_points is not None else 40.0)
        current = float(d.current_load_points if d.current_load_points is not None else 0.0)
        total_capacity += max(0.0, cap - current)

    sprint_days = _days_between(constraints.sprint_start, constraints.sprint_end)
    utilization = (total_points / total_capacity) if total_capacity > 0 else 999.0

    if utilization > 1.1:
        risks.append(
            RiskItem(
                category="deadline-risk",
                severity="high",
                message=f"Planned points {total_points:.1f} exceed remaining capacity {total_capacity:.1f}.",
                details={"planned_points": total_points, "remaining_capacity": total_capacity, "utilization": utilization},
            )
        )
    elif utilization > 0.95:
        risks.append(
            RiskItem(
                category="deadline-risk",
                severity="medium",
                message=f"Planned points {total_points:.1f} are close to remaining capacity {total_capacity:.1f}.",
                details={"planned_points": total_points, "remaining_capacity": total_capacity, "utilization": utilization},
            )
        )

    if sprint_days is not None and sprint_days < 7 and total_points > 0:
        risks.append(
            RiskItem(
                category="short-sprint",
                severity="medium",
                message=f"Sprint length is {sprint_days} days; consider reducing scope.",
                details={"sprint_days": sprint_days},
            )
        )

    return {"risks": risks}


def sprint_finalizer_agent(state: PlanningState) -> Dict[str, Any]:
    sprint_name = state.get("sprint_name", "Sprint")
    assignments = state.get("assignments", [])
    risks = state.get("risks", [])

    # summary
    avg_conf = sum(a.confidence for a in assignments) / max(1, len(assignments))
    summary = {
        "ticket_count": len(assignments),
        "avg_confidence": round(float(avg_conf), 3),
        "risk_count": len(risks),
    }

    plan = SprintPlanOut(
        sprint_name=sprint_name,
        assignments=assignments,
        risks=risks,
        summary=summary,
    )

    return {"final_plan": plan.model_dump()}


def _route_after_backlog(state: PlanningState) -> str:
    tickets = state.get("ticket_analysis", [])
    return "SprintFinalizerAgent" if not tickets else "DeveloperProfileAgent"


def build_sprint_planning_graph():
    graph = StateGraph(PlanningState)

    graph.add_node("BacklogAnalyzerAgent", backlog_analyzer_agent)
    graph.add_node("DeveloperProfileAgent", developer_profile_agent)
    graph.add_node("AssignmentOptimizerAgent", assignment_optimizer_agent)
    graph.add_node("RiskAssessorAgent", risk_assessor_agent)
    graph.add_node("SprintFinalizerAgent", sprint_finalizer_agent)

    graph.set_entry_point("BacklogAnalyzerAgent")

    graph.add_conditional_edges(
        "BacklogAnalyzerAgent",
        _route_after_backlog,
        {
            "DeveloperProfileAgent": "DeveloperProfileAgent",
            "SprintFinalizerAgent": "SprintFinalizerAgent",
        },
    )

    graph.add_edge("DeveloperProfileAgent", "AssignmentOptimizerAgent")
    graph.add_edge("AssignmentOptimizerAgent", "RiskAssessorAgent")
    graph.add_edge("RiskAssessorAgent", "SprintFinalizerAgent")
    graph.add_edge("SprintFinalizerAgent", END)

    return graph.compile()
