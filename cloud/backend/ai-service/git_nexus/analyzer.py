"""
GitNexus Core Analysis Engine
Analyzes GitHub repositories for sprint task generation
"""

import argparse
import json
import logging
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from git import Repo
from git.exc import GitCommandError

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


class GitNexusAnalyzer:
    """Analyzes GitHub repositories for sprint planning insights."""

    def __init__(self, repo_path: str = "/tmp/nexus_repo"):
        self.repo_path = repo_path
        self.repo = None
        self.project_structure = {}

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

    def detect_project_structure(self) -> dict:
        """Detect project type, root files, and key directories."""
        logger.info("🏗️  Detecting project structure")

        ignored_dirs = {
            ".git",
            "node_modules",
            ".venv",
            "venv",
            "dist",
            "build",
            ".next",
            "__pycache__",
        }

        structure = {
            "project_type": "Unknown",
            "root_files": [],
            "key_dirs": [],
            "package_files": [],
            "is_monorepo": False,
            "frameworks": [],
            "all_dirs": [],
            "all_files": [],
            "scan_depth": max(2, int(os.getenv("GITNEXUS_SCAN_DEPTH", "12"))),
            "all_dirs_total": 0,
            "all_files_total": 0,
            "all_dirs_truncated": False,
            "all_files_truncated": False,
        }

        # Check root-level files
        root_files = {
            "package.json": "Node.js",
            "pom.xml": "Maven/Java",
            "build.gradle": "Gradle/Java",
            "requirements.txt": "Python",
            "Pipfile": "Python/Pipenv",
            "go.mod": "Go",
            "Cargo.toml": "Rust",
            ".net": ".NET",
            "composer.json": "PHP",
        }

        try:
            for item in sorted(os.listdir(self.repo_path)):
                item_path = os.path.join(self.repo_path, item)
                if os.path.isfile(item_path):
                    structure["root_files"].append(item)
        except Exception as e:
            logger.warning(f"⚠️  Failed to list root files: {str(e)[:80]}")

        found_types = []
        for root_file, project_type in root_files.items():
            if root_file in structure["root_files"]:
                found_types.append(project_type)
                structure["package_files"].append(root_file)

        # Detect project type from root files
        if "package.json" in structure["root_files"]:
            structure["project_type"] = "Node.js/TypeScript"
        elif "pom.xml" in structure["root_files"]:
            structure["project_type"] = "Java/Maven"
        elif "build.gradle" in structure["root_files"]:
            structure["project_type"] = "Java/Gradle"
        elif "requirements.txt" in structure["root_files"] or "Pipfile" in structure["root_files"]:
            structure["project_type"] = "Python"
        elif "go.mod" in structure["root_files"]:
            structure["project_type"] = "Go"
        elif "Cargo.toml" in structure["root_files"]:
            structure["project_type"] = "Rust"

        # Scan nested directories/files up to a bounded depth for large repositories.
        all_dirs = []
        all_files = []
        package_file_names = {
            "package.json",
            "pnpm-workspace.yaml",
            "yarn.lock",
            "package-lock.json",
            "requirements.txt",
            "Pipfile",
            "pyproject.toml",
            "poetry.lock",
            "pom.xml",
            "build.gradle",
            "go.mod",
            "Cargo.toml",
            "composer.json",
        }
        max_depth = int(structure["scan_depth"])

        for root, dirs, files in os.walk(self.repo_path):
            rel_root = os.path.relpath(root, self.repo_path)
            depth = 0 if rel_root == "." else rel_root.count(os.sep) + 1
            dirs[:] = [d for d in dirs if d not in ignored_dirs]

            if depth > max_depth:
                dirs[:] = []
                continue

            for d in dirs:
                path = os.path.join(rel_root, d) if rel_root != "." else d
                all_dirs.append(path.replace("\\", "/"))

            for f in files:
                if f.startswith(".") and f not in {".env", ".env.example"}:
                    continue
                path = os.path.join(rel_root, f) if rel_root != "." else f
                normalized = path.replace("\\", "/")
                all_files.append(normalized)
                if f in package_file_names and normalized not in structure["package_files"]:
                    structure["package_files"].append(normalized)

        structure["all_dirs"] = sorted(all_dirs)
        structure["all_files"] = sorted(all_files)
        structure["all_dirs_total"] = len(structure["all_dirs"])
        structure["all_files_total"] = len(structure["all_files"])

        # Detect common key directories (both root and nested)
        key_dir_patterns = [
            "src", "lib", "app", "components", "hooks", "tests", "test",
            "backend", "frontend", "services", "docs", "database", "public",
            "scripts", "types", "utils", "models", "views", "pages", "store",
            "routes", "middleware", "config", "constants", "helpers",
        ]
        detected_dirs = set()
        for key_dir in key_dir_patterns:
            path = os.path.join(self.repo_path, key_dir)
            if os.path.isdir(path):
                detected_dirs.add(key_dir)
            else:
                # Check one level deeper (for monorepo-like structures)
                for subdir in os.listdir(self.repo_path):
                    subpath = os.path.join(self.repo_path, subdir)
                    if os.path.isdir(subpath) and subdir not in ignored_dirs:
                        nested_path = os.path.join(subpath, key_dir)
                        if os.path.isdir(nested_path):
                            detected_dirs.add(f"{subdir}/{key_dir}")
                            break

        if detected_dirs:
            structure["key_dirs"] = sorted(list(detected_dirs))
        else:
            # Fallback to a broad sample when pattern matching finds nothing.
            structure["key_dirs"] = structure["all_dirs"][:80]

        # Check for monorepo patterns
        workspace_files = ["lerna.json", "pnpm-workspace.yaml", "rush.json"]
        for wf in workspace_files:
            if os.path.exists(os.path.join(self.repo_path, wf)):
                structure["is_monorepo"] = True
                break

        # If monorepo, find workspaces
        if structure["is_monorepo"]:
            workspaces = []
            for item in os.listdir(self.repo_path):
                item_path = os.path.join(self.repo_path, item)
                if os.path.isdir(item_path) and item not in ignored_dirs:
                    if os.path.exists(os.path.join(item_path, "package.json")):
                        workspaces.append(item)
            if workspaces:
                structure["workspaces"] = workspaces

        # Detect frameworks by parsing package.json or scanning imports
        if "package.json" in structure["root_files"]:
            try:
                pkg_path = os.path.join(self.repo_path, "package.json")
                with open(pkg_path, "r", encoding="utf-8") as f:
                    pkg_data = json.load(f)
                    deps = pkg_data.get("dependencies", {})
                    dev_deps = pkg_data.get("devDependencies", {})
                    all_deps = {**deps, **dev_deps}
                    
                    framework_keywords = {
                        "react": "React",
                        "next": "Next.js",
                        "vue": "Vue.js",
                        "express": "Express",
                        "fastify": "Fastify",
                        "nestjs": "NestJS",
                        "prisma": "Prisma",
                        "typeorm": "TypeORM",
                    }
                    
                    for keyword, framework in framework_keywords.items():
                        if any(keyword in dep for dep in all_deps):
                            structure["frameworks"].append(framework)
            except Exception as e:
                logger.warning(f"⚠️  Failed to parse package.json: {str(e)[:50]}")

        # Keep payload bounded for very large repositories while exposing totals.
        max_dirs = int(os.getenv("GITNEXUS_ALL_DIRS_MAX", "2000"))
        max_files = int(os.getenv("GITNEXUS_ALL_FILES_MAX", "4000"))
        structure["all_dirs_truncated"] = len(structure["all_dirs"]) > max_dirs
        structure["all_files_truncated"] = len(structure["all_files"]) > max_files
        structure["all_dirs"] = structure["all_dirs"][:max_dirs]
        structure["all_files"] = structure["all_files"][:max_files]

        logger.info(f"✅ Detected: {structure['project_type']}, Frameworks: {structure['frameworks']}")
        self.project_structure = structure
        return structure

    def clone_repo(self, repo_url: str, github_token: str = "", branch: str = "") -> bool:
        """Clone repository with shallow depth."""
        try:
            canonical_url = self._normalize_repo_url(repo_url)
            logger.info(f"🔍 Cloning repository: {canonical_url}")
            
            if not os.path.exists(self.repo_path):
                os.makedirs(self.repo_path)
            
            # Use token in URL if provided
            clone_url = canonical_url
            if github_token:
                clone_url = canonical_url.replace(
                    "https://github.com",
                    f"https://{github_token}@github.com"
                )
            
            clone_kwargs = {"depth": 50}
            if branch:
                clone_kwargs["branch"] = branch

            self.repo = Repo.clone_from(
                clone_url,
                self.repo_path,
                **clone_kwargs,
            )
            logger.info(f"✅ Repository cloned successfully")
            return True
        except GitCommandError as e:
            logger.error(f"❌ Git error: {str(e)[:100]}")
            return False
        except Exception as e:
            logger.error(f"❌ Clone error: {str(e)[:100]}")
            return False

    def analyze_commits(self, since_days: int = 30) -> dict:
        """Analyze commit history."""
        logger.info(f"📊 Analyzing commits (last {since_days} days)")
        
        if not self.repo:
            return {}
        
        try:
            since_date = datetime.now() - timedelta(days=since_days)
            commits = list(
                self.repo.iter_commits(
                    since=since_date.isoformat(),
                    max_count=1000,
                )
            )
            
            commit_data = []
            authors = {}
            
            for commit in commits:
                msg = commit.message.strip().split("\n")[0]
                author_email = commit.author.email
                
                # Detect conventional commit type
                commit_type = "chore"
                for prefix in ["feat", "fix", "chore", "refactor", "test", "docs"]:
                    if msg.lower().startswith(prefix + "(") or msg.lower().startswith(prefix + ":"):
                        commit_type = prefix
                        break
                
                commit_data.append({
                    "hash": commit.hexsha[:7],
                    "message": msg,
                    "author": author_email,
                    "type": commit_type,
                    "files_changed": len(commit.stats.files),
                })
                
                if author_email not in authors:
                    authors[author_email] = 0
                authors[author_email] += 1
            
            logger.info(f"✅ Analyzed {len(commits)} commits from {len(authors)} authors")
            
            return {
                "total_commits": len(commits),
                "authors": authors,
                "commits": commit_data,
            }
        except Exception as e:
            logger.error(f"❌ Commit analysis error: {str(e)[:100]}")
            return {}

    def detect_open_work(self) -> list:
        """Scan for TODO/FIXME/HACK/BUG comments."""
        logger.info("🔍 Scanning for open work (TODO/FIXME/HACK/BUG)")
        
        open_work = []
        patterns = ["TODO", "FIXME", "HACK", "BUG"]
        
        try:
            for root, dirs, files in os.walk(self.repo_path):
                # Skip .git and node_modules
                dirs[:] = [d for d in dirs if d not in [".git", "node_modules", ".venv", "venv"]]
                
                for file in files:
                    if file.startswith("."):
                        continue
                    
                    filepath = os.path.join(root, file)
                    try:
                        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                            for line_num, line in enumerate(f, 1):
                                for pattern in patterns:
                                    if pattern in line:
                                        rel_path = filepath.replace(self.repo_path + os.sep, "")
                                        open_work.append({
                                            "file": rel_path,
                                            "line": line_num,
                                            "type": pattern,
                                            "text": line.strip()[:100],
                                        })
                    except Exception:
                        pass
        except Exception as e:
            logger.error(f"⚠️ Open work scan error: {str(e)[:100]}")
        
        logger.info(f"✅ Found {len(open_work)} open work items")
        return open_work[:50]  # Limit to 50

    def analyze_file_heatmap(self, since_days: int = 30) -> dict:
        """Analyze file change frequency and tech domain classification."""
        logger.info("🔥 Analyzing file change heatmap")
        
        file_changes = {}
        tech_domains = {
            "frontend": [".tsx", ".jsx", ".css", ".html", ".scss"],
            "backend": [".py", ".go", ".java", ".rs", ".cs"],
            "infra": [".yaml", ".yml", ".tf", "Dockerfile"],
            "database": [".sql"],
            "tests": [".test.", ".spec."],
        }
        
        try:
            if not self.repo:
                return {}
            
            since_date = datetime.now() - timedelta(days=since_days)
            commits = list(
                self.repo.iter_commits(
                    since=since_date.isoformat(),
                    max_count=1000,
                )
            )
            
            for commit in commits:
                for file in commit.stats.files.keys():
                    file_changes[file] = file_changes.get(file, 0) + 1
            
            # Classify by tech domain
            domain_breakdown = {domain: [] for domain in tech_domains.keys()}
            for file, count in sorted(file_changes.items(), key=lambda x: x[1], reverse=True)[:50]:
                for domain, extensions in tech_domains.items():
                    if any(ext in file for ext in extensions):
                        domain_breakdown[domain].append({"file": file, "changes": count})
                        break
            
            logger.info(f"✅ Analyzed {len(file_changes)} files")
            return {
                "total_files_changed": len(file_changes),
                "hottest_files": sorted(
                    file_changes.items(),
                    key=lambda x: x[1],
                    reverse=True,
                )[:10],
                "domain_breakdown": domain_breakdown,
            }
        except Exception as e:
            logger.error(f"⚠️ File heatmap error: {str(e)[:100]}")
            return {}

    def analyze_dependency_drift(self) -> list:
        """Detect dependency versions and outdated packages."""
        logger.info("📦 Analyzing dependency drift")
        
        drift_issues = []
        
        try:
            # Check package.json
            package_json_path = os.path.join(self.repo_path, "package.json")
            if os.path.exists(package_json_path):
                try:
                    import json as json_lib
                    with open(package_json_path, "r", encoding="utf-8") as f:
                        pkg = json_lib.load(f)
                    
                    for pkg_type in ["dependencies", "devDependencies"]:
                        for pkg_name, version in pkg.get(pkg_type, {}).items():
                            # Flag major version gaps (e.g., ^1.0.0 when latest is 3+)
                            if version.startswith("^0") or version.startswith("~0"):
                                drift_issues.append({
                                    "file": "package.json",
                                    "package": pkg_name,
                                    "current": version,
                                    "concern": "Pre-release version",
                                    "type": "npm",
                                })
                except Exception:
                    pass
            
            # Check requirements.txt
            req_path = os.path.join(self.repo_path, "requirements.txt")
            if os.path.exists(req_path):
                try:
                    with open(req_path, "r", encoding="utf-8") as f:
                        for line in f:
                            if "==" in line or "<" in line or ">" in line:
                                # Has version pin
                                parts = line.split("==")
                                if len(parts) == 2:
                                    pkg_name = parts[0].strip()
                                    version = parts[1].strip()
                                    # Simple check: very old versions
                                    if version.startswith("0.0"):
                                        drift_issues.append({
                                            "file": "requirements.txt",
                                            "package": pkg_name,
                                            "current": version,
                                            "concern": "Outdated version",
                                            "type": "python",
                                        })
                except Exception:
                    pass
            
            logger.info(f"✅ Found {len(drift_issues)} dependency concerns")
            return drift_issues
        except Exception as e:
            logger.error(f"⚠️ Dependency drift error: {str(e)[:100]}")
            return []

    def analyze_symbol_inventory(self) -> dict:
        """Build a lightweight symbol inventory by scanning common language patterns."""
        logger.info("🧠 Scanning symbol inventory (functions/classes/interfaces)")

        ignored_dirs = {".git", "node_modules", ".venv", "venv", "dist", "build", ".next", "__pycache__"}
        patterns = {
            "function": [
                re.compile(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.MULTILINE),
                re.compile(r"^\s*function\s+([A-Za-z_$][\w$]*)\s*\(", re.MULTILINE),
                re.compile(r"^\s*(?:export\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*=\s*\([^\)]*\)\s*=>", re.MULTILINE),
                re.compile(r"^\s*(?:public|private|protected)?\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^\)]*\)\s*\{", re.MULTILINE),
            ],
            "class": [
                re.compile(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE),
                re.compile(r"^\s*(?:export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE),
            ],
            "interface": [
                re.compile(r"^\s*(?:export\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE),
            ],
        }
        code_exts = {".py", ".ts", ".tsx", ".js", ".jsx", ".java", ".go", ".rs", ".cs", ".php"}

        by_file = []
        totals = {"function": 0, "class": 0, "interface": 0}

        try:
            max_scan_files = max(100, int(os.getenv("GITNEXUS_SYMBOL_SCAN_MAX_FILES", "5000")))
            max_symbol_files = max(100, int(os.getenv("GITNEXUS_SYMBOL_TOP_FILES_MAX", "500")))
            scanned = 0
            for root, dirs, files in os.walk(self.repo_path):
                dirs[:] = [d for d in dirs if d not in ignored_dirs]
                for file_name in files:
                    ext = os.path.splitext(file_name)[1].lower()
                    if ext not in code_exts:
                        continue

                    file_path = os.path.join(root, file_name)
                    rel_path = file_path.replace(self.repo_path + os.sep, "").replace("\\", "/")
                    scanned += 1
                    if scanned > max_scan_files:
                        break

                    try:
                        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                            text = f.read()
                    except Exception:
                        continue

                    symbols = {"function": [], "class": [], "interface": []}
                    for symbol_type, regexes in patterns.items():
                        found_names = set()
                        for regex in regexes:
                            for match in regex.finditer(text):
                                name = match.group(1)
                                if name and name not in found_names:
                                    found_names.add(name)
                        symbols[symbol_type] = sorted(found_names)
                        totals[symbol_type] += len(symbols[symbol_type])

                    if any(symbols.values()):
                        by_file.append(
                            {
                                "file": rel_path,
                                "functions": symbols["function"][:30],
                                "classes": symbols["class"][:20],
                                "interfaces": symbols["interface"][:20],
                            }
                        )

                if scanned > max_scan_files:
                    break

            by_file = sorted(
                by_file,
                key=lambda item: len(item.get("functions", [])) + len(item.get("classes", [])) + len(item.get("interfaces", [])),
                reverse=True,
            )

            return {
                "totals": totals,
                "files_scanned": min(scanned, max_scan_files),
                "files_with_symbols": len(by_file),
                "top_files": by_file[:max_symbol_files],
                "truncated": len(by_file) > max_symbol_files,
            }
        except Exception as e:
            logger.error(f"⚠️ Symbol inventory error: {str(e)[:100]}")
            return {
                "totals": totals,
                "files_scanned": 0,
                "files_with_symbols": 0,
                "top_files": [],
            }

    def detect_stale_branches(self, days: int = 30) -> list:
        """Find unmerged branches older than N days."""
        logger.info(f"🌿 Detecting stale branches (>{days} days)")
        
        stale = []
        try:
            cutoff = datetime.now() - timedelta(days=days)
            
            for ref in self.repo.heads:
                if ref.name == "main" or ref.name == "master":
                    continue
                
                commit_time = datetime.fromtimestamp(ref.commit.committed_date)
                if commit_time < cutoff:
                    stale.append({
                        "branch": ref.name,
                        "days_old": (datetime.now() - commit_time).days,
                        "last_commit": ref.commit.hexsha[:7],
                    })
            
            logger.info(f"✅ Found {len(stale)} stale branches")
        except Exception as e:
            logger.error(f"⚠️ Stale branch detection error: {str(e)[:100]}")
        
        return stale[:10]

    def analyze_repo_size(self) -> int:
        """Get repository size in KB."""
        try:
            result = subprocess.run(
                ["du", "-sk", self.repo_path],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return int(result.stdout.split()[0])
        except Exception:
            return 0

    def detect_primary_language(self) -> str:
        """Detect primary programming language."""
        extensions = {}
        
        try:
            for root, dirs, files in os.walk(self.repo_path):
                dirs[:] = [d for d in dirs if d not in [".git", "node_modules", ".venv"]]
                
                for file in files:
                    ext = os.path.splitext(file)[1]
                    if ext:
                        extensions[ext] = extensions.get(ext, 0) + 1
        except Exception:
            pass
        
        lang_map = {
            ".py": "Python",
            ".ts": "TypeScript",
            ".tsx": "TypeScript",
            ".js": "JavaScript",
            ".jsx": "JavaScript",
            ".go": "Go",
            ".java": "Java",
            ".cs": "C#",
            ".rs": "Rust",
        }
        
        for ext, lang in lang_map.items():
            if extensions.get(ext, 0) > 5:
                return lang
        
        return "Other"

    def run_analysis(
        self,
        repo_url: str,
        github_token: str = "",
        branch: str = "",
        since_days: int = 30,
    ) -> dict:
        """Main analysis orchestration."""
        try:
            if not self.clone_repo(repo_url, github_token, branch):
                raise Exception("Clone failed")
            
            # Detect project structure early to guide analysis
            project_structure = self.detect_project_structure()
            
            commit_data = self.analyze_commits(since_days)
            open_work = self.detect_open_work()
            stale_branches = self.detect_stale_branches()
            file_heatmap = self.analyze_file_heatmap(since_days)
            dependency_issues = self.analyze_dependency_drift()
            symbol_inventory = self.analyze_symbol_inventory()
            repo_size = self.analyze_repo_size()
            primary_lang = self.detect_primary_language()
            
            # Generate suggested tasks
            suggested_tasks = []
            
            # Tasks from open work
            for item in open_work:
                suggested_tasks.append({
                    "title": f"Address {item['type']} in {item['file']}",
                    "description": f"{item['text'][:80]}",
                    "tech_tags": [primary_lang],
                    "story_points": 3,
                    "priority": "high" if item["type"] == "BUG" else "medium",
                    "source": "todo_comment",
                    "suggested_assignee_email": None,
                    "evidence": {
                        "files": [item["file"]],
                        "commits": [],
                        "authors": [],
                    },
                })
            
            # Tasks from stale branches
            for branch in stale_branches:
                suggested_tasks.append({
                    "title": f"Clean up stale branch: {branch['branch']}",
                    "description": f"Branch is {branch['days_old']} days old",
                    "tech_tags": ["DevOps"],
                    "story_points": 2,
                    "priority": "low",
                    "source": "stale_branch",
                    "suggested_assignee_email": None,
                    "evidence": {
                        "files": [],
                        "commits": [branch["last_commit"]],
                        "authors": [],
                    },
                })
            
            # Tasks from hottest files
            hottest_files = file_heatmap.get("hottest_files", [])
            if hottest_files:
                top_file, change_count = hottest_files[0]
                suggested_tasks.append({
                    "title": f"Refactor hotfile: {top_file}",
                    "description": f"High change frequency ({change_count} modifications). Consider breaking into smaller modules.",
                    "tech_tags": [primary_lang],
                    "story_points": 5,
                    "priority": "medium",
                    "source": "hotfile",
                    "suggested_assignee_email": None,
                    "evidence": {
                        "files": [top_file],
                        "commits": [],
                        "authors": [],
                    },
                })
            
            # Tasks from dependency drift
            for dep_issue in dependency_issues[:3]:
                suggested_tasks.append({
                    "title": f"Update {dep_issue['package']} dependency",
                    "description": f"Current: {dep_issue['current']}. {dep_issue['concern']}",
                    "tech_tags": ["DevOps"],
                    "story_points": 3,
                    "priority": "low",
                    "source": "dependency_drift",
                    "suggested_assignee_email": None,
                    "evidence": {
                        "files": [dep_issue["file"]],
                        "commits": [],
                        "authors": [],
                    },
                })
            
            # Developer insights
            developer_insights = []
            for email, count in sorted(
                commit_data.get("authors", {}).items(),
                key=lambda x: x[1],
                reverse=True,
            )[:5]:
                developer_insights.append({
                    "email": email,
                    "commits": count,
                    "lines_added": 0,
                    "lines_deleted": 0,
                    "primary_files": [],
                    "primary_tech": [primary_lang],
                    "suggested_capacity_points": 21,
                })
            
            # Risk signals
            risk_signals = []
            if len(developer_insights) < 2:
                risk_signals.append({
                    "type": "bus_factor",
                    "severity": "high",
                    "detail": "Low number of active contributors",
                    "files": [],
                })
            
            if len(open_work) > 10:
                risk_signals.append({
                    "type": "technical_debt",
                    "severity": "medium",
                    "detail": "High number of open work items",
                    "files": [item["file"] for item in open_work[:5]],
                })
            
            # Risk from hotfile
            hottest_files = file_heatmap.get("hottest_files", [])
            if hottest_files and hottest_files[0][1] > 20:
                risk_signals.append({
                    "type": "large_file",
                    "severity": "medium",
                    "detail": f"File {hottest_files[0][0]} changed {hottest_files[0][1]} times (potential complexity)",
                    "files": [hottest_files[0][0]],
                })
            
            # Risk from dependencies
            if len(dependency_issues) > 0:
                risk_signals.append({
                    "type": "dependency_outdated",
                    "severity": "low",
                    "detail": f"{len(dependency_issues)} packages with version concerns",
                    "files": [d["file"] for d in dependency_issues[:3]],
                })
            
            result = {
                "repo_meta": {
                    "url": self._normalize_repo_url(repo_url),
                    "branch": branch,
                    "total_commits_analyzed": commit_data.get("total_commits", 0),
                    "analysis_window_days": since_days,
                    "repo_size_kb": repo_size,
                    "primary_language": primary_lang,
                    "languages_detected": [primary_lang],
                },
                "project_structure": project_structure,
                "symbol_inventory": symbol_inventory,
                "file_heatmap": file_heatmap,
                "dependency_drift": dependency_issues,
                "suggested_tasks": suggested_tasks,
                "developer_insights": developer_insights,
                "risk_signals": risk_signals,
            }
            
            return result
        finally:
            # Cleanup
            try:
                import shutil
                if os.path.exists(self.repo_path):
                    shutil.rmtree(self.repo_path)
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser(description="GitNexus Repository Analyzer")
    parser.add_argument("--repo-url", required=True, help="GitHub repository URL")
    parser.add_argument("--token", default="", help="GitHub token for private repos")
    parser.add_argument("--branch", default="", help="Branch to analyze")
    parser.add_argument("--since-days", type=int, default=30, help="Days to analyze")
    
    args = parser.parse_args()
    
    analyzer = GitNexusAnalyzer()
    result = analyzer.run_analysis(
        repo_url=args.repo_url,
        github_token=args.token,
        branch=args.branch,
        since_days=args.since_days,
    )
    
    print(json.dumps(result))


if __name__ == "__main__":
    main()
