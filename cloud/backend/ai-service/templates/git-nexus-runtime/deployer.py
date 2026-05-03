#!/usr/bin/env python3
"""
E2B Template Deployer for GitNexus
Builds and pushes template to E2B registry following SecDev patterns.

Usage:
  python3 deployer.py --build-only       # Only build local Dockerfile
  python3 deployer.py --push             # Build and push to E2B
  python3 deployer.py --verify           # Verify template in E2B
"""

import argparse
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class E2BTemplateDeployer:
    """Manages E2B template deployment for GitNexus."""

    def __init__(self):
        self.api_key = os.getenv("E2B_API_KEY", "")
        self.gh_token = os.getenv("GITHUB_TOKEN", "")
        self.template_path = Path(__file__).parent
        self.template_name = "agile-gitnexus-runtime"
        self.dockerfile = self.template_path / "Dockerfile"
        self.start_script = self.template_path / "start.sh"
        self.config_file = self.template_path / "e2b.toml"

    def validate_environment(self) -> bool:
        """Check required files and environment."""
        logger.info("📋 Validating environment...")
        
        errors = []
        
        if not self.dockerfile.exists():
            errors.append(f"❌ Dockerfile not found: {self.dockerfile}")
        else:
            logger.info(f"✅ Dockerfile found: {self.dockerfile.stat().st_size} bytes")
        
        if not self.start_script.exists():
            errors.append(f"❌ start.sh not found: {self.start_script}")
        else:
            logger.info(f"✅ start.sh found: {self.start_script.stat().st_size} bytes")
        
        if not self.config_file.exists():
            errors.append(f"❌ e2b.toml not found: {self.config_file}")
        else:
            logger.info(f"✅ e2b.toml found: {self.config_file.stat().st_size} bytes")
        
        if not self.api_key:
            logger.warning("⚠️  E2B_API_KEY not set (needed for --push)")
        
        if errors:
            for error in errors:
                logger.error(error)
            return False
        
        logger.info("✅ All files validated")
        return True

    def build_locally(self) -> bool:
        """Build Docker image locally for testing."""
        logger.info(f"🔨 Building Docker image: {self.template_name}...")
        
        try:
            result = subprocess.run(
                [
                    "docker",
                    "build",
                    "-t",
                    self.template_name,
                    "-f",
                    str(self.dockerfile),
                    str(self.template_path),
                ],
                capture_output=True,
                text=True,
                timeout=600,
            )
            
            if result.returncode != 0:
                logger.error(f"❌ Build failed:\n{result.stderr}")
                return False
            
            logger.info("✅ Docker build successful")
            return True
        
        except subprocess.TimeoutExpired:
            logger.error("❌ Build timeout (>10 minutes)")
            return False
        except Exception as e:
            logger.error(f"❌ Build error: {str(e)}")
            return False

    def push_to_e2b(self) -> Optional[str]:
        """Push template to E2B registry."""
        if not self.api_key:
            logger.error("❌ E2B_API_KEY required for --push")
            return None
        
        logger.info(f"🚀 Pushing template to E2B: {self.template_name}...")
        
        try:
            # Step 1: Build locally first
            if not self.build_locally():
                return None
            
            # Step 2: Push via E2B CLI (requires `e2b` command installed)
            logger.info("📤 Uploading to E2B registry...")
            result = subprocess.run(
                [
                    "e2b",
                    "template",
                    "build",
                    "--dockerfile",
                    str(self.dockerfile),
                    "--name",
                    self.template_name,
                ],
                capture_output=True,
                text=True,
                env={**os.environ, "E2B_API_KEY": self.api_key},
                timeout=1200,
            )
            
            if result.returncode != 0:
                logger.error(f"❌ E2B push failed:\n{result.stderr}")
                return None
            
            # Extract template ID from output
            template_id = self.template_name
            if "template_id" in result.stdout:
                try:
                    data = json.loads(result.stdout)
                    template_id = data.get("template_id", template_id)
                except:
                    pass
            
            logger.info(f"✅ Template pushed to E2B")
            logger.info(f"   Template ID: {template_id}")
            
            return template_id
        
        except subprocess.TimeoutExpired:
            logger.error("❌ E2B push timeout (>20 minutes)")
            return None
        except FileNotFoundError:
            logger.error("❌ E2B CLI not installed. Install with: npm install -g @e2b/cli")
            return None
        except Exception as e:
            logger.error(f"❌ Push error: {str(e)}")
            return None

    def verify_template(self) -> bool:
        """Verify template works in E2B."""
        if not self.api_key:
            logger.error("❌ E2B_API_KEY required for --verify")
            return False
        
        logger.info(f"✅ Verifying template: {self.template_name}...")
        
        try:
            # Try to create a test sandbox
            result = subprocess.run(
                [
                    "e2b",
                    "sandbox",
                    "create",
                    "--template",
                    self.template_name,
                    "--code",
                    "python3 -c 'print(\"OK\")'",
                ],
                capture_output=True,
                text=True,
                env={**os.environ, "E2B_API_KEY": self.api_key},
                timeout=120,
            )
            
            if result.returncode == 0 and "OK" in result.stdout:
                logger.info("✅ Template verification passed")
                return True
            else:
                logger.error(f"❌ Verification failed:\n{result.stderr}")
                return False
        
        except Exception as e:
            logger.error(f"❌ Verification error: {str(e)}")
            return False

    def print_next_steps(self, template_id: Optional[str] = None):
        """Print integration next steps."""
        logger.info("\n" + "=" * 60)
        logger.info("NEXT STEPS")
        logger.info("=" * 60)
        
        if template_id:
            logger.info(f"\n1️⃣  Template ID: {template_id}")
            logger.info("   Add to cloud/backend/ai-service/.env:")
            logger.info(f"   E2B_TEMPLATE={self.template_name}")
            logger.info(f"   E2B_TEMPLATE_ID={template_id}")
        
        logger.info("\n2️⃣  Wire GitNexus router into main.py:")
        logger.info("   from git_nexus.routes import router as git_nexus_router")
        logger.info("   app.include_router(git_nexus_router, prefix='/api/v1')")
        
        logger.info("\n3️⃣  Set environment variables (all required):")
        logger.info("   E2B_API_KEY=<your_e2b_api_key>")
        logger.info("   GITHUB_TOKEN=<your_github_token>")
        logger.info("   DATABASE_URL=<your_postgres_url>")
        
        logger.info("\n4️⃣  Test the endpoint:")
        logger.info("   curl -X POST http://localhost:8000/api/v1/git-nexus/analyze \\")
        logger.info("     -H 'Content-Type: application/json' \\")
        logger.info("     -d '{")
        logger.info('       "repo_url": "https://github.com/owner/repo",')
        logger.info('       "project_id": "project-123",')
        logger.info('       "branch": "main",')
        logger.info('       "since_days": 30')
        logger.info("     }'")
        
        logger.info("\n" + "=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="E2B Template Deployer for GitNexus"
    )
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="Build Docker image locally (no upload)"
    )
    parser.add_argument(
        "--push",
        action="store_true",
        help="Build and push to E2B registry"
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Verify template in E2B"
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate environment and files"
    )
    
    args = parser.parse_args()
    
    deployer = E2BTemplateDeployer()
    
    # Default: validate
    if not any([args.build_only, args.push, args.verify, args.validate]):
        args.validate = True
    
    # Validate
    if args.validate or args.build_only or args.push or args.verify:
        if not deployer.validate_environment():
            sys.exit(1)
    
    # Build locally
    if args.build_only:
        if deployer.build_locally():
            logger.info("\n✅ Local build complete. Ready for E2B deployment.")
        else:
            sys.exit(1)
    
    # Push to E2B
    template_id = None
    if args.push:
        template_id = deployer.push_to_e2b()
        if not template_id:
            sys.exit(1)
    
    # Verify
    if args.verify:
        if deployer.verify_template():
            logger.info("✅ Template verified and ready to use")
        else:
            sys.exit(1)
    
    # Print next steps
    deployer.print_next_steps(template_id)


if __name__ == "__main__":
    main()
