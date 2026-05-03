"""
E2B Sandbox Template for GitNexus Analysis
Pre-configured environment for repository analysis
"""

import os


class E2BSandboxTemplate:
    """Template for E2B sandbox environment"""
    
    # System dependencies
    SYSTEM_PACKAGES = [
        "git",
        "curl",
        "wget",
        "build-essential",
        "python3-dev",
    ]
    
    # Python packages
    PYTHON_PACKAGES = [
        "gitpython>=3.1.43",
        "httpx>=0.27.0",
        "pydantic>=2.0.0",
        "asyncpg>=0.29.0",
    ]
    
    # Analysis script template
    ANALYSIS_SCRIPT = """
import json
import logging
import os
from datetime import datetime, timedelta
from git import Repo
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

class RepositoryAnalyzer:
    def __init__(self, repo_path="/tmp/repo"):
        self.repo_path = repo_path
        
    def clone(self, url, token="", branch="main"):
        logger.info(f"🔍 Cloning: {url}")
        if not os.path.exists(self.repo_path):
            os.makedirs(self.repo_path)
        
        clone_url = url
        if token and "github.com" in url:
            clone_url = url.replace("https://github.com", f"https://{token}@github.com")
        
        self.repo = Repo.clone_from(clone_url, self.repo_path, depth=50, branch=branch)
        logger.info("✅ Clone complete")
        return True
    
    def analyze_commits(self, days=30):
        logger.info(f"📊 Analyzing {days} days of commits")
        since_date = datetime.now() - timedelta(days=days)
        commits = list(self.repo.iter_commits(since=since_date.isoformat(), max_count=1000))
        
        authors = {}
        commit_types = {"feat": 0, "fix": 0, "chore": 0, "refactor": 0, "test": 0}
        
        for commit in commits:
            msg = commit.message.strip().split("\\n")[0]
            author_email = commit.author.email
            
            commit_type = "chore"
            for ctype in commit_types.keys():
                if msg.lower().startswith(ctype + "(") or msg.lower().startswith(ctype + ":"):
                    commit_type = ctype
                    break
            
            commit_types[commit_type] += 1
            authors[author_email] = authors.get(author_email, 0) + 1
        
        logger.info(f"✅ Analyzed {len(commits)} commits")
        return {
            "total": len(commits),
            "authors": authors,
            "types": commit_types,
        }
    
    def find_todos(self):
        logger.info("🔍 Scanning for TODOs, FIXMEs, BUGs")
        todos = []
        patterns = ["TODO", "FIXME", "HACK", "BUG"]
        
        for root, dirs, files in os.walk(self.repo_path):
            dirs[:] = [d for d in dirs if d not in [".git", "node_modules", ".venv"]]
            
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
                                    todos.append({
                                        "file": rel_path,
                                        "line": line_num,
                                        "type": pattern,
                                        "text": line.strip()[:100],
                                    })
                except:
                    pass
        
        logger.info(f"✅ Found {len(todos)} items")
        return todos[:50]
    
    def detect_language(self):
        logger.info("🔍 Detecting primary language")
        ext_count = {}
        
        for root, dirs, files in os.walk(self.repo_path):
            dirs[:] = [d for d in dirs if d not in [".git", "node_modules", ".venv"]]
            for file in files:
                ext = Path(file).suffix
                if ext:
                    ext_count[ext] = ext_count.get(ext, 0) + 1
        
        lang_map = {
            ".py": "Python", ".ts": "TypeScript", ".js": "JavaScript",
            ".go": "Go", ".java": "Java", ".cs": "C#", ".rs": "Rust"
        }
        
        for ext, lang in lang_map.items():
            if ext_count.get(ext, 0) > 5:
                return lang
        
        return "Other"
    
    def run(self, repo_url, token="", branch="main", days=30):
        try:
            self.clone(repo_url, token, branch)
            
            result = {
                "repo_url": repo_url,
                "branch": branch,
                "analysis_window_days": days,
                "commits": self.analyze_commits(days),
                "open_work": self.find_todos(),
                "primary_language": self.detect_language(),
            }
            
            return result
        except Exception as e:
            return {"error": str(e)[:200]}

if __name__ == "__main__":
    import sys
    
    repo_url = sys.argv[1] if len(sys.argv) > 1 else "https://github.com/torvalds/linux"
    token = os.getenv("GITHUB_TOKEN", "")
    branch = sys.argv[2] if len(sys.argv) > 2 else "main"
    days = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    
    analyzer = RepositoryAnalyzer()
    result = analyzer.run(repo_url, token, branch, days)
    
    print(json.dumps(result))
"""
    
    @staticmethod
    def get_setup_script() -> str:
        """Return bash script to setup sandbox environment"""
        return """#!/bin/bash
set -e

echo "📦 Installing system packages..."
apt-get update
apt-get install -y git curl wget build-essential python3-dev

echo "🐍 Installing Python packages..."
pip install gitpython httpx pydantic asyncpg

echo "✅ Environment ready"
"""
    
    @staticmethod
    def get_analysis_script() -> str:
        """Return the analysis script"""
        return E2BSandboxTemplate.ANALYSIS_SCRIPT
    
    @staticmethod
    def get_docker_template() -> str:
        """Return Dockerfile for custom E2B image (optional)"""
        return """FROM python:3.11-slim

RUN apt-get update && apt-get install -y \\
    git \\
    curl \\
    wget \\
    build-essential \\
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \\
    gitpython>=3.1.43 \\
    httpx>=0.27.0 \\
    pydantic>=2.0.0 \\
    asyncpg>=0.29.0

WORKDIR /workspace

CMD ["/bin/bash"]
"""
