"""
GitNexus Data Mapper
Maps repository analysis to sprint task schema
"""

import asyncio
import difflib
import logging
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)


class NexusMapper:
    """Maps GitNexus analysis output to sprint task schema."""

    def __init__(self, db_connection_string: str):
        self.db_url = db_connection_string
        self.pool = None
        self._match_report = {
            "total_suggested": 0,
            "deduplicated": 0,
            "assigned_developers": 0,
            "unassigned": 0,
            "skipped_reasons": {},
        }

    async def connect(self):
        """Open asyncpg pool."""
        try:
            self.pool = await asyncpg.create_pool(
                self.db_url,
                min_size=1,
                max_size=5,
            )
            logger.info("✅ Database pool connected")
        except Exception as e:
            logger.error(f"❌ Database connection error: {e}")

    async def disconnect(self):
        """Close asyncpg pool."""
        if self.pool:
            await self.pool.close()
            logger.info("✅ Database pool closed")

    async def _fetch_developers(self) -> list:
        """Fetch active developers from DB."""
        if not self.pool:
            return []
        
        try:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT id, email, name, tech_stack, current_sprint_load, max_sprint_capacity
                    FROM app.developers
                    WHERE deleted_at IS NULL
                    """
                )
                return [dict(row) for row in rows]
        except Exception as e:
            logger.warning(f"⚠️ Fetch developers error: {e}")
            return []

    async def _fetch_existing_tasks(self, project_id: str) -> list:
        """Fetch open tasks for deduplication."""
        if not self.pool:
            return []
        
        try:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT id, title, status
                    FROM app.tasks
                    WHERE project_id = $1 AND status IN ('todo', 'in_progress', 'in_review')
                    """,
                    project_id,
                )
                return [dict(row) for row in rows]
        except Exception as e:
            logger.warning(f"⚠️ Fetch tasks error: {e}")
            return []

    def match_developers(self, suggested_tasks: list, db_developers: list) -> list:
        """Assign tasks to developers by email and capacity."""
        logger.info("🔄 Matching developers to tasks")
        
        for task in suggested_tasks:
            assignee_email = task.get("suggested_assignee_email")
            
            if not assignee_email:
                continue
            
            # Try exact email match
            matched_dev = None
            for dev in db_developers:
                if dev["email"] == assignee_email:
                    # Check capacity
                    if dev["current_sprint_load"] < dev["max_sprint_capacity"]:
                        matched_dev = dev
                        break
            
            # Fallback: find by tech overlap
            if not matched_dev:
                task_tags = set(task.get("tech_tags", []))
                best_overlap = 0
                
                for dev in db_developers:
                    if dev["current_sprint_load"] >= dev["max_sprint_capacity"]:
                        continue
                    
                    dev_tech = set(dev.get("tech_stack", []))
                    overlap = len(task_tags & dev_tech)
                    
                    if overlap > best_overlap:
                        best_overlap = overlap
                        matched_dev = dev
            
            if matched_dev:
                task["assignee_id"] = matched_dev["id"]
                self._match_report["assigned_developers"] += 1
            else:
                task["assignee_id"] = None
                self._match_report["unassigned"] += 1
        
        return suggested_tasks

    def deduplicate_tasks(self, suggested_tasks: list, existing_tasks: list) -> list:
        """Remove near-duplicate tasks using fuzzy matching."""
        logger.info("🔄 Deduplicating tasks")
        
        filtered = []
        existing_titles = [t["title"] for t in existing_tasks]
        
        for task in suggested_tasks:
            skip = False
            
            for existing_title in existing_titles:
                similarity = difflib.SequenceMatcher(
                    None,
                    task["title"].lower(),
                    existing_title.lower(),
                ).ratio()
                
                if similarity > 0.80:
                    reason = f"Duplicate of: {existing_title}"
                    self._match_report["skipped_reasons"][reason] = (
                        self._match_report["skipped_reasons"].get(reason, 0) + 1
                    )
                    self._match_report["deduplicated"] += 1
                    skip = True
                    break
            
            if not skip:
                filtered.append(task)
        
        return filtered

    def enrich_descriptions(self, tasks: list, repo_meta: dict, risk_signals: list) -> list:
        """Enrich descriptions with evidence and context."""
        logger.info("🔄 Enriching descriptions")
        
        for task in tasks:
            evidence = task.get("evidence", {})
            description = task.get("description", "")
            
            # Add files
            if evidence.get("files"):
                files_str = "\n".join([f"- `{f}`" for f in evidence["files"][:5]])
                description += f"\n\n**Files:**\n{files_str}"
            
            # Add commits
            if evidence.get("commits"):
                commits_str = "\n".join([f"- {c[:7]}" for c in evidence["commits"][:5]])
                description += f"\n\n**Related Commits:**\n{commits_str}"
            
            # Add risks
            task_files = set(evidence.get("files", []))
            related_risks = [
                r for r in risk_signals
                if any(f in task_files for f in r.get("files", []))
            ]
            
            if related_risks:
                risks_str = "\n".join(
                    [f"- **{r['type']}** ({r['severity']}): {r['detail']}" for r in related_risks]
                )
                description += f"\n\n**⚠️ Risk Signals:**\n{risks_str}"
            
            # Add repo link
            if repo_meta.get("url"):
                description += f"\n\n**Repository:** [{repo_meta['url']}]({repo_meta['url']})"
            
            task["description"] = description
        
        return tasks

    def build_sprint_context(self, nexus_result: dict, current_sprint: dict = None) -> dict:
        """Build sprint context with metrics and goals."""
        logger.info("🔄 Building sprint context")
        
        repo_meta = nexus_result.get("repo_meta", {})
        project_structure = nexus_result.get("project_structure", {})
        symbol_inventory = nexus_result.get("symbol_inventory", {})
        file_heatmap = nexus_result.get("file_heatmap", {})
        dependency_drift = nexus_result.get("dependency_drift", [])
        sandbox_config = nexus_result.get("sandbox_config", {})
        suggested_tasks = nexus_result.get("suggested_tasks", [])
        developer_insights = nexus_result.get("developer_insights", [])
        risk_signals = nexus_result.get("risk_signals", [])
        
        # Calculate metrics
        window = repo_meta.get("analysis_window_days", 30)
        total_commits = repo_meta.get("total_commits_analyzed", 0)
        commit_velocity = total_commits / window if window > 0 else 0
        
        active_contributors = len(developer_insights)
        
        # Find hotspot files
        all_files = []
        for task in suggested_tasks:
            all_files.extend(task.get("evidence", {}).get("files", []))
        hotspot_files = sorted(
            set(all_files),
            key=lambda f: all_files.count(f),
            reverse=True,
        )[:5]
        
        # Build risk summary
        high_risks = [r for r in risk_signals if r["severity"] == "high"]
        risk_summary = (
            f"⚠️ {len(high_risks)} high-severity risks detected"
            if high_risks
            else "✅ No high-severity risks"
        )
        
        # Suggest sprint goal from feat commits
        feat_tasks = [t for t in suggested_tasks if "feat" in t.get("source", "")]
        goal = ", ".join([t["title"] for t in feat_tasks[:3]])
        if not goal:
            goal = f"Analyze {repo_meta.get('primary_language', 'codebase')} improvements"
        
        return {
            "nexus_enrichment": {
                "commit_velocity": round(commit_velocity, 2),
                "active_contributors": active_contributors,
                "hotspot_files": hotspot_files,
                "risk_summary": risk_summary,
                "suggested_sprint_goal": f"Ship: {goal}",
            },
            "suggested_tasks": suggested_tasks,
            "developer_insights": developer_insights,
            "risk_signals": risk_signals,
            "repo_meta": repo_meta,
            "project_structure": project_structure,
            "symbol_inventory": symbol_inventory,
            "file_heatmap": file_heatmap,
            "dependency_drift": dependency_drift,
            "sandbox_config": sandbox_config,
        }

    def to_api_gateway_payload(self, sprint_context: dict) -> dict:
        """Format for API gateway."""
        return {
            "enrichment": sprint_context.get("nexus_enrichment", {}),
            "suggested_tasks": sprint_context.get("suggested_tasks", []),
            "developer_insights": sprint_context.get("developer_insights", []),
            "risk_signals": sprint_context.get("risk_signals", []),
            "repo_meta": sprint_context.get("repo_meta", {}),
            "project_structure": sprint_context.get("project_structure", {}),
            "symbol_inventory": sprint_context.get("symbol_inventory", {}),
            "file_heatmap": sprint_context.get("file_heatmap", {}),
            "dependency_drift": sprint_context.get("dependency_drift", []),
            "sandbox_config": sprint_context.get("sandbox_config", {}),
            "source": "gitnexus",
        }

    async def map_to_sprint(
        self,
        nexus_result: dict,
        project_id: str,
        sprint_id: str = None,
    ) -> dict:
        """Main orchestration: apply all transformations."""
        logger.info(f"🔄 Mapping analysis to sprint for project {project_id}")
        
        self._match_report = {
            "total_suggested": 0,
            "deduplicated": 0,
            "assigned_developers": 0,
            "unassigned": 0,
            "skipped_reasons": {},
        }
        
        try:
            # Fetch data
            developers = await self._fetch_developers()
            existing_tasks = await self._fetch_existing_tasks(project_id)
            
            suggested_tasks = nexus_result.get("suggested_tasks", [])
            self._match_report["total_suggested"] = len(suggested_tasks)
            
            # Apply transformations
            suggested_tasks = self.match_developers(suggested_tasks, developers)
            suggested_tasks = self.deduplicate_tasks(suggested_tasks, existing_tasks)
            suggested_tasks = self.enrich_descriptions(
                suggested_tasks,
                nexus_result.get("repo_meta", {}),
                nexus_result.get("risk_signals", []),
            )
            
            # Build context
            sprint_context = self.build_sprint_context(nexus_result)
            sprint_context["suggested_tasks"] = suggested_tasks
            
            # Format payload
            payload = self.to_api_gateway_payload(sprint_context)
            payload["project_id"] = project_id
            
            return {
                "event": "complete",
                "data": payload,
                "stats": self._match_report,
            }
        except Exception as e:
            logger.error(f"❌ Mapping error: {e}")
            raise

    def get_match_report(self) -> dict:
        """Return mapping statistics."""
        return self._match_report
