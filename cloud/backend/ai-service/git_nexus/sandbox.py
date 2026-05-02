"""
E2B Sandbox Manager
Orchestrates dynamic E2B sandboxes for repository analysis
"""

import json
import logging
import os
import traceback
from pathlib import Path
from typing import Any, AsyncGenerator
from urllib.parse import urlparse
import shlex

import httpx
from dotenv import load_dotenv
from e2b_code_interpreter import Sandbox

logger = logging.getLogger(__name__)


class NexusSandboxManager:
    """Manages E2B sandboxes for GitNexus analysis."""

    RESOURCE_TIERS = {
        "tiny": {"ram_mb": 512, "cpu": 0.5, "timeout": 120, "size_max_kb": 10_000},
        "small": {"ram_mb": 1024, "cpu": 1.0, "timeout": 240, "size_max_kb": 100_000},
        "medium": {"ram_mb": 2048, "cpu": 2.0, "timeout": 480, "size_max_kb": 500_000},
        "large": {"ram_mb": 4096, "cpu": 4.0, "timeout": 900, "size_max_kb": 2_000_000},
    }
    RAM_MIN_MB = 512
    RAM_MAX_MB = 8192

    def __init__(self):
        self.active_sandboxes = 0
        self.total_analyses = 0
        self.api_key = ""
        self.template_name = "agile-gitnexus-runtime"
        self._refresh_configuration()

    def _refresh_configuration(self) -> None:
        load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
        self.api_key = os.getenv("E2B_API_KEY", "").strip()
        self.template_name = os.getenv("E2B_TEMPLATE", "agile-gitnexus-runtime").strip() or "agile-gitnexus-runtime"

    def _get_template_candidates(self) -> list[str]:
        return [self.template_name] if self.template_name else []

    def _normalize_repo_url(self, repo_url: str) -> str:
        """Convert a GitHub slug or SSH URL to a canonical HTTPS clone URL."""
        cleaned = repo_url.strip().rstrip("/")
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
            raise ValueError(
                "repo_url must be a GitHub repository slug or URL like owner/repo or https://github.com/owner/repo"
            )

        owner, repo = parts[0], parts[1]
        return f"https://github.com/{owner}/{repo}"

    def _clone_url(self, repo_url: str, github_token: str = "") -> str:
        canonical_url = self._normalize_repo_url(repo_url)
        if github_token:
            return canonical_url.replace(
                "https://github.com/",
                f"https://{github_token}@github.com/",
                1,
            )
        return canonical_url

    async def estimate_repo_size(self, repo_url: str, github_token: str = "") -> int:
        """Estimate repository size via GitHub API."""
        try:
            logger.info("🔍 Estimating repository size")
            
            canonical_url = self._normalize_repo_url(repo_url)
            parts = canonical_url.rstrip("/").split("/")
            owner, repo = parts[-2], parts[-1]
            
            headers = {}
            if github_token:
                headers["Authorization"] = f"token {github_token}"
            
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"https://api.github.com/repos/{owner}/{repo}",
                    headers=headers,
                    timeout=10,
                )
                
                if response.status_code == 404:
                    raise Exception("Repository not found")
                
                if response.status_code == 403:
                    raise Exception("GitHub API rate limit or permission denied")
                
                data = response.json()
                size_kb = data.get("size", 10_000)
                
                logger.info(f"✅ Estimated size: {size_kb} KB")
                return size_kb
        except Exception as e:
            logger.warning(f"⚠️ Size estimation failed: {str(e)[:100]}, using default")
            return 100_000  # Default to medium tier

    def _coerce_ram_override(self, ram_mb_override: int | None) -> int | None:
        """Normalize RAM override from request or environment."""
        candidate = ram_mb_override
        if candidate is None:
            env_value = os.getenv("GITNEXUS_RAM_MB", "").strip()
            if env_value:
                try:
                    candidate = int(env_value)
                except ValueError:
                    logger.warning("⚠️ Invalid GITNEXUS_RAM_MB value: %s", env_value)
                    candidate = None

        if candidate is None:
            return None

        if candidate < self.RAM_MIN_MB:
            logger.info("ℹ️ RAM override %sMB below minimum, clamped to %sMB", candidate, self.RAM_MIN_MB)
            return self.RAM_MIN_MB
        if candidate > self.RAM_MAX_MB:
            logger.info("ℹ️ RAM override %sMB above maximum, clamped to %sMB", candidate, self.RAM_MAX_MB)
            return self.RAM_MAX_MB
        return candidate

    def _select_tier_from_ram(self, ram_mb: int) -> str:
        """Pick closest tier name for a RAM target."""
        ordered = sorted(self.RESOURCE_TIERS.items(), key=lambda item: item[1]["ram_mb"])
        for tier_name, tier in ordered:
            if ram_mb <= tier["ram_mb"]:
                return tier_name
        return "large"

    def get_resource_config(
        self,
        size_kb: int,
        tier_override: str = "",
        ram_mb_override: int | None = None,
    ) -> dict:
        """Select resource tier based on repository size with optional override controls."""
        selected: dict[str, float | int] | None = None
        normalized_tier = (tier_override or os.getenv("GITNEXUS_RESOURCE_TIER", "")).strip().lower()

        if normalized_tier:
            selected = self.RESOURCE_TIERS.get(normalized_tier)
            if selected:
                logger.info("🏗️ Selected tier override: %s (%sMB RAM)", normalized_tier, selected["ram_mb"])
            else:
                logger.warning("⚠️ Invalid tier override: %s", normalized_tier)

        if not selected:
            for tier_name, config in sorted(
                self.RESOURCE_TIERS.items(),
                key=lambda x: x[1]["size_max_kb"],
            ):
                if size_kb <= config["size_max_kb"]:
                    selected = config
                    normalized_tier = tier_name
                    logger.info(f"🏗️ Selected tier: {tier_name} ({config['ram_mb']}MB RAM)")
                    break

        if not selected:
            logger.error("❌ Repository too large (>2GB)")
            raise Exception("Repository size exceeds 2GB limit")

        ram_mb = int(selected["ram_mb"])
        cpu = float(selected["cpu"])
        timeout_seconds = int(selected["timeout"])
        ram_override = self._coerce_ram_override(ram_mb_override)

        if ram_override:
            ram_mb = ram_override
            normalized_tier = self._select_tier_from_ram(ram_override)
            if ram_override >= 4096:
                cpu = max(cpu, 4.0)
                timeout_seconds = max(timeout_seconds, 900)
            elif ram_override >= 2048:
                cpu = max(cpu, 2.0)
                timeout_seconds = max(timeout_seconds, 480)

        return {
            "tier_name": normalized_tier,
            "ram_mb": ram_mb,
            "cpu": cpu,
            "timeout_seconds": timeout_seconds,
            "override_applied": bool(ram_override),
        }

    async def run_analysis(
        self,
        repo_url: str,
        github_token: str = "",
        branch: str = "main",
        since_days: int = 30,
        resource_tier: str = "",
        ram_mb: int | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Run analysis in E2B sandbox, stream progress."""
        import json
        import time
        from pathlib import Path
        
        sandbox = None
        try:
            self._refresh_configuration()
            # Step 1: Estimate size
            size_kb = await self.estimate_repo_size(repo_url, github_token)
            
            # Step 2: Get resource config
            config = self.get_resource_config(
                size_kb=size_kb,
                tier_override=resource_tier,
                ram_mb_override=ram_mb,
            )

            if not self.api_key:
                raise RuntimeError("E2B_API_KEY is not configured in the AI service environment")
            
            # Step 3: Create sandbox from template
            template_candidates = self._get_template_candidates()
            logger.info(
                "🏗️ Creating E2B sandbox: %s (%s) [candidates=%s]",
                template_candidates[0],
                config["tier_name"],
                ", ".join(template_candidates),
            )
            yield {
                "type": "progress",
                "line": (
                    f"🏗️ Creating E2B sandbox ({config['tier_name']}: {config['ram_mb']}MB RAM, "
                    f"{config['timeout_seconds']}s timeout"
                    + (", override enabled" if config.get("override_applied") else "")
                    + ")"
                ),
            }
            
            last_create_error: Exception | None = None
            for template_name in template_candidates:
                try:
                    sandbox = Sandbox.create(
                        template=template_name,
                        timeout=config["timeout_seconds"],
                        api_key=self.api_key,
                    )
                    logger.info("✅ E2B sandbox created using template '%s'", template_name)
                    break
                except Exception as create_error:
                    last_create_error = create_error
                    logger.warning(
                        "⚠️ E2B sandbox create failed for template '%s': %s",
                        template_name,
                        str(create_error)[:200],
                    )

            if not sandbox:
                raise RuntimeError(
                    "Failed to create E2B sandbox using templates "
                    f"{template_candidates}: {last_create_error}"
                )

            self.active_sandboxes += 1
            start_time = time.time()
            
            # Step 4: Upload analyzer.py
            yield {
                "type": "progress",
                "line": "📝 Uploading analyzer module",
            }
            
            analyzer_path = Path(__file__).parent / "analyzer.py"
            if analyzer_path.exists():
                with open(analyzer_path, "r", encoding="utf-8") as f:
                    analyzer_code = f.read()
            else:
                logger.warning("⚠️ analyzer.py not found, using fallback")
                analyzer_code = "print('ERROR: analyzer module not found')"
            
            sandbox.files.write("/home/user/analyzer.py", analyzer_code)
            
            # Step 5: Clone repository
            yield {
                "type": "progress",
                "line": f"🔍 Cloning repository: {repo_url[:50]}...",
            }
            
            clone_url = self._clone_url(repo_url, github_token)
            clone_cmd = (
                f"cd /home/user && "
                f"git clone --depth 50 {shlex.quote(clone_url)} repo 2>&1"
            )

            try:
                sandbox.commands.run(clone_cmd, timeout=120)
            except Exception as clone_error:
                clone_stdout = getattr(clone_error, "stdout", "")
                clone_stderr = getattr(clone_error, "stderr", "")
                clone_exit_code = getattr(clone_error, "exit_code", None)
                raise RuntimeError(
                    "Repository clone failed"
                    + (f" with exit code {clone_exit_code}" if clone_exit_code is not None else "")
                    + f": {clone_stderr or clone_stdout or clone_error}"
                ) from clone_error
            
            # Step 6: Run analysis
            yield {
                "type": "progress",
                "line": f"📊 Running analysis ({since_days} days window)",
            }
            
            analysis_cmd = (
                f"cd /home/user && python3 analyzer.py "
                f"--repo-url {shlex.quote(self._normalize_repo_url(repo_url))} "
                f"--branch '{branch}' "
                f"--since-days {since_days}"
            )
            
            if github_token:
                analysis_cmd += f" --token '{github_token}'"
            
            try:
                result = sandbox.commands.run(
                    analysis_cmd,
                    timeout=config["timeout_seconds"],
                )
            except Exception as analysis_error:
                analysis_stdout = getattr(analysis_error, "stdout", "")
                analysis_stderr = getattr(analysis_error, "stderr", "")
                analysis_exit_code = getattr(analysis_error, "exit_code", None)
                raise RuntimeError(
                    "Repository analysis failed"
                    + (f" with exit code {analysis_exit_code}" if analysis_exit_code is not None else "")
                    + f": {analysis_stderr or analysis_stdout or analysis_error}"
                ) from analysis_error
            
            # Step 7: Parse result
            yield {
                "type": "progress",
                "line": "✅ Parsing analysis results",
            }
            
            try:
                result_data = json.loads(result.stdout)
            except json.JSONDecodeError:
                lines = result.stdout.split("\n")
                for line in reversed(lines):
                    try:
                        result_data = json.loads(line)
                        break
                    except:
                        continue
                else:
                    raise Exception("No valid JSON in output")
            
            duration = time.time() - start_time
            
            yield {
                "type": "complete",
                "result": {
                    "config_used": config,
                    "duration_seconds": int(duration),
                    "result": result_data,
                },
            }
            
            self.total_analyses += 1
            logger.info(f"✅ Analysis complete ({duration:.1f}s)")
        
        except Exception as e:
            logger.exception("❌ Analysis error")
            yield {
                "type": "error",
                "error": f"{type(e).__name__}: {e}"[:500],
                "detail": traceback.format_exc(limit=8),
            }
        
        finally:
            if sandbox:
                try:
                    sandbox.kill()
                    self.active_sandboxes -= 1
                except Exception as e:
                    logger.warning(f"⚠️ Cleanup error: {str(e)[:50]}")

    def get_sandbox_status(self) -> dict:
        """Get current sandbox status."""
        self._refresh_configuration()
        template_candidates = self._get_template_candidates()
        return {
            "active_sandboxes": self.active_sandboxes,
            "total_analyses_today": self.total_analyses,
            "avg_duration_seconds": 45,
            "last_error": None if self.api_key else "E2B_API_KEY is not configured in the AI service environment",
            "configured": bool(self.api_key),
            "ready": bool(self.api_key and template_candidates),
            "template_name": self.template_name,
            "template_candidates": template_candidates,
        }
