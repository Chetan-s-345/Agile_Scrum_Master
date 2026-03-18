#!/usr/bin/env python3
"""Neon API credential checker.

- Reads keys from environment variables and/or a .env file.
- Verifies credentials using GET /users/me.
- Optionally lists organizations and projects (org-scoped).
- Does NOT print secrets.

Usage examples:
    # From repo root:
    python tools/neon_key_check.py --env backend/api-gateway/.env
    python tools/neon_key_check.py --env backend/api-gateway/.env --list-orgs
    python tools/neon_key_check.py --env backend/api-gateway/.env --org-id org-xxxx --list-projects

    # From tools/:
    python neon_key_check.py --env .env
    python neon_key_check.py --env .env --list-orgs
    python neon_key_check.py --env .env --org-id org-xxxx --list-projects

Optional (dangerous): create a project (may consume quota/billing):
    # From repo root:
    python tools/neon_key_check.py --env backend/api-gateway/.env --org-id org-xxxx --create-project --project-name test-proj --region-id aws-us-east-2

    # From tools/:
    python neon_key_check.py --env .env --org-id org-xxxx --create-project --project-name test-proj --region-id aws-us-east-2
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional, Tuple


DEFAULT_BASE_URL = "https://console.neon.tech/api/v2"


def _mask_secret(value: Optional[str]) -> str:
    if not value:
        return "<empty>"
    v = value.strip()
    if len(v) <= 10:
        return "***"
    return f"{v[:6]}...{v[-4:]}"


def _read_dotenv(path: str) -> Dict[str, str]:
    """Minimal .env parser (no external dependencies)."""
    out: Dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                if k.startswith("export "):
                    k = k[len("export ") :].strip()
                v = v.strip()
                # Strip surrounding quotes if present
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]
                out[k] = v
    except FileNotFoundError:
        return out
    return out


def _resolve_env_path(env_path: str) -> Tuple[Optional[str], list[str]]:
    """Resolve env path robustly so the script works from any cwd.

    Returns (resolved_path_or_none, tried_paths).
    """
    raw = (env_path or "").strip()
    if not raw:
        return None, []

    p = Path(raw)
    tried: list[Path] = []
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent

    # 1) As provided (absolute or relative to current working directory)
    tried.append(p)
    if p.is_file():
        return str(p), [str(x) for x in tried]

    # If user passes plain '.env', prefer service envs before repo root env.
    if p.name == ".env" and len(p.parts) == 1:
        preferred = [
            repo_root / "backend" / "api-gateway" / ".env",
            script_dir / ".env",
            repo_root / ".env",
        ]
        for candidate in preferred:
            tried.append(candidate)
            if candidate.is_file():
                return str(candidate), [str(x) for x in tried]
    else:
        # 2) Relative to this script directory
        p2 = script_dir / raw
        tried.append(p2)
        if p2.is_file():
            return str(p2), [str(x) for x in tried]

        # 3) Relative to repo root (assume tools/ is directly under repo root)
        p3 = repo_root / raw
        tried.append(p3)
        if p3.is_file():
            return str(p3), [str(x) for x in tried]

    return None, [str(x) for x in tried]


def _http_json(
    method: str,
    url: str,
    *,
    headers: Dict[str, str],
    body: Optional[Dict[str, Any]] = None,
    timeout: int = 30,
) -> Tuple[int, Dict[str, Any]]:
    data_bytes = None
    if body is not None:
        data_bytes = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url=url, method=method.upper(), data=data_bytes)
    for k, v in headers.items():
        req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = getattr(resp, "status", 200)
            raw = resp.read().decode("utf-8", errors="replace")
            if not raw:
                return status, {}
            try:
                return status, json.loads(raw)
            except json.JSONDecodeError:
                return status, {"_raw": raw}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"_raw": raw}
        return int(getattr(e, "code", 0) or 0), payload


def _build_url(base_url: str, path: str, params: Optional[Dict[str, str]] = None) -> str:
    base = base_url.rstrip("/")
    p = path if path.startswith("/") else f"/{path}"
    url = f"{base}{p}"
    if params:
        return f"{url}?{urllib.parse.urlencode(params)}"
    return url


def _extract_error_message(data: Dict[str, Any]) -> str:
    msg = data.get("message")
    if isinstance(msg, str) and msg.strip():
        return msg.strip()
    if "error" in data and isinstance(data["error"], str):
        return data["error"].strip()
    return "<no message>"


def _is_org_key_users_me_restriction(status: int, message: str) -> bool:
    msg = (message or "").strip().lower()
    if status not in (403, 404):
        return False
    return "organization api keys" in msg and "not allowed" in msg


def check_users_me(base_url: str, api_key: str) -> Tuple[bool, int, Dict[str, Any]]:
    url = _build_url(base_url, "/users/me")
    status, data = _http_json(
        "GET",
        url,
        headers={
            "accept": "application/json",
            "authorization": f"Bearer {api_key}",
        },
    )
    ok = 200 <= status < 300
    return ok, status, data


def list_orgs(base_url: str, api_key: str) -> Tuple[bool, int, Dict[str, Any]]:
    url = _build_url(base_url, "/users/me/organizations")
    status, data = _http_json(
        "GET",
        url,
        headers={
            "accept": "application/json",
            "authorization": f"Bearer {api_key}",
        },
    )
    ok = 200 <= status < 300
    return ok, status, data


def list_projects(base_url: str, api_key: str, org_id: Optional[str]) -> Tuple[bool, int, Dict[str, Any]]:
    params = {"org_id": org_id} if org_id else None
    url = _build_url(base_url, "/projects", params=params)
    status, data = _http_json(
        "GET",
        url,
        headers={
            "accept": "application/json",
            "authorization": f"Bearer {api_key}",
        },
    )
    ok = 200 <= status < 300
    return ok, status, data


def create_project(
    base_url: str,
    api_key: str,
    org_id: Optional[str],
    project_name: str,
    region_id: Optional[str],
) -> Tuple[bool, int, Dict[str, Any]]:
    params = {"org_id": org_id} if org_id else None
    url = _build_url(base_url, "/projects", params=params)

    project: Dict[str, Any] = {"name": project_name}
    if region_id:
        project["region_id"] = region_id

    status, data = _http_json(
        "POST",
        url,
        headers={
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": f"Bearer {api_key}",
        },
        body={"project": project},
    )
    ok = 200 <= status < 300
    return ok, status, data


def _pick_org_id(data: Dict[str, Any]) -> Optional[str]:
    orgs = data.get("organizations")
    if isinstance(orgs, list) and orgs:
        first = orgs[0]
        if isinstance(first, dict):
            oid = first.get("id") or first.get("org_id")
            if isinstance(oid, str) and oid:
                return oid
    return None


def _looks_like_placeholder_org_id(value: Optional[str]) -> bool:
    v = str(value or "").strip().lower()
    if not v:
        return False
    return v == "org-xxxx" or "xxxx" in v or v.endswith("-example")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", dest="env_path", default=None, help="Path to .env (optional)")
    ap.add_argument("--base-url", dest="base_url", default=DEFAULT_BASE_URL)

    ap.add_argument("--list-orgs", action="store_true")
    ap.add_argument("--org-id", dest="org_id", default=None)
    ap.add_argument("--list-projects", action="store_true")

    ap.add_argument("--create-project", action="store_true")
    ap.add_argument("--project-name", default="copilot-check-project")
    ap.add_argument("--region-id", default=None)

    args = ap.parse_args()

    dotenv: Dict[str, str] = {}
    if args.env_path:
        resolved, tried = _resolve_env_path(args.env_path)
        if not resolved:
            print("ERROR: .env file not found.")
            if tried:
                print("Tried:")
                for t in tried:
                    print(" -", t)
            print("Hint: from repo root you can use: --env backend/api-gateway/.env")
            print("Hint: from tools/ you can use: --env ../backend/api-gateway/.env")
            return 2
        dotenv = _read_dotenv(resolved)

    neon_api_key = (os.environ.get("NEON_API_KEY") or dotenv.get("NEON_API_KEY") or "").strip()
    neon_org_key = (os.environ.get("NEON_ORG_KEY") or dotenv.get("NEON_ORG_KEY") or "").strip()
    neon_org_id = (args.org_id or os.environ.get("NEON_ORG_ID") or dotenv.get("NEON_ORG_ID") or "").strip() or None

    if _looks_like_placeholder_org_id(neon_org_id):
        print("ERROR: NEON_ORG_ID looks like a placeholder value:", neon_org_id)
        print("Use a real Neon organization id from Neon organization settings (example: org-tiny-silence-38745211).")
        return 2

    print("Neon API base:", args.base_url)
    print("NEON_API_KEY:", _mask_secret(neon_api_key))
    print("NEON_ORG_KEY:", _mask_secret(neon_org_key))
    print("NEON_ORG_ID:", neon_org_id or "<not set>")

    if not neon_api_key and not neon_org_key:
        print("ERROR: Missing credentials. Set NEON_API_KEY or NEON_ORG_KEY (env var or in .env).")
        return 2

    # Check both keys independently if present.
    keys_to_check = []
    if neon_api_key:
        keys_to_check.append(("NEON_API_KEY", neon_api_key))
    if neon_org_key and neon_org_key != neon_api_key:
        keys_to_check.append(("NEON_ORG_KEY", neon_org_key))

    any_ok = False

    for label, key in keys_to_check:
        print(f"\n== Checking {label} ==")
        ok, status, data = check_users_me(args.base_url, key)
        rid = data.get("request_id") if isinstance(data, dict) else None
        err_msg = _extract_error_message(data if isinstance(data, dict) else {})
        if ok:
            any_ok = True
            user = data.get("user") if isinstance(data, dict) else None
            email = user.get("email") if isinstance(user, dict) else None
            print(f"/users/me: OK ({status})")
            if email:
                print("User:", email)
        else:
            # Org-scoped Neon keys are intentionally blocked from /users/me.
            if label == "NEON_ORG_KEY" and _is_org_key_users_me_restriction(status, err_msg):
                print(f"/users/me: SKIP ({status})")
                if rid:
                    print("request_id:", rid)
                print("message:", err_msg)
                if neon_org_id:
                    probe_ok, probe_status, probe_data = list_projects(args.base_url, key, neon_org_id)
                    probe_rid = probe_data.get("request_id") if isinstance(probe_data, dict) else None
                    if probe_ok:
                        any_ok = True
                        print(f"/projects (org-key probe): OK ({probe_status})")
                    else:
                        print(f"/projects (org-key probe): FAIL ({probe_status})")
                        if probe_rid:
                            print("request_id:", probe_rid)
                        print("message:", _extract_error_message(probe_data if isinstance(probe_data, dict) else {}))
                        continue
                else:
                    print("Hint: set --org-id (or NEON_ORG_ID) to validate NEON_ORG_KEY via /projects.")
                    continue
            else:
                print(f"/users/me: FAIL ({status})")
                if rid:
                    print("request_id:", rid)
                print("message:", err_msg)
                continue

        if args.list_orgs:
            if label == "NEON_ORG_KEY":
                print("/users/me/organizations: SKIP (not applicable for organization API keys)")
            else:
                ok2, status2, data2 = list_orgs(args.base_url, key)
                rid2 = data2.get("request_id") if isinstance(data2, dict) else None
                if ok2:
                    print(f"/users/me/organizations: OK ({status2})")
                    picked = _pick_org_id(data2 if isinstance(data2, dict) else {})
                    if picked and not neon_org_id:
                        print("Hint: set NEON_ORG_ID to:", picked)
                else:
                    print(f"/users/me/organizations: FAIL ({status2})")
                    if rid2:
                        print("request_id:", rid2)
                    print("message:", _extract_error_message(data2 if isinstance(data2, dict) else {}))

        if args.list_projects:
            ok3, status3, data3 = list_projects(args.base_url, key, neon_org_id)
            rid3 = data3.get("request_id") if isinstance(data3, dict) else None
            if ok3:
                print(f"/projects: OK ({status3})")
                projects = data3.get("projects") if isinstance(data3, dict) else None
                if isinstance(projects, list):
                    print("projects_count:", len(projects))
            else:
                print(f"/projects: FAIL ({status3})")
                if rid3:
                    print("request_id:", rid3)
                print("message:", _extract_error_message(data3 if isinstance(data3, dict) else {}))

        if args.create_project:
            if not neon_org_id:
                print("ERROR: --create-project requires --org-id (or NEON_ORG_ID).")
                continue
            ok4, status4, data4 = create_project(
                args.base_url,
                key,
                neon_org_id,
                args.project_name,
                args.region_id,
            )
            rid4 = data4.get("request_id") if isinstance(data4, dict) else None
            if ok4:
                print(f"POST /projects: OK ({status4})")
                project = data4.get("project") if isinstance(data4, dict) else None
                pid = project.get("id") if isinstance(project, dict) else None
                if pid:
                    print("project_id:", pid)
                conn_uris = data4.get("connection_uris") if isinstance(data4, dict) else None
                if isinstance(conn_uris, list) and conn_uris:
                    uri = conn_uris[0].get("connection_uri") if isinstance(conn_uris[0], dict) else None
                    if isinstance(uri, str) and uri:
                        # Avoid leaking the connection string; just show host.
                        try:
                            parsed = urllib.parse.urlparse(uri)
                            print("connection_host:", parsed.hostname)
                        except Exception:
                            pass
            else:
                print(f"POST /projects: FAIL ({status4})")
                if rid4:
                    print("request_id:", rid4)
                print("message:", _extract_error_message(data4 if isinstance(data4, dict) else {}))

    if not any_ok:
        print("\nRESULT: No provided key authenticated successfully.")
        return 1

    print("\nRESULT: At least one key authenticated successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
