#!/bin/bash
# GitNexus E2B Runtime Entry Script
# Orchestrates repository analysis using external GitNexus tool
# Source: https://github.com/abhigyanpatwari/GitNexus

set -e

normalize_repo_url() {
  local repo_input="$1"
  repo_input="${repo_input%.git}"

  if [[ "$repo_input" == git@github.com:* ]]; then
    repo_input="${repo_input#git@github.com:}"
  elif [[ "$repo_input" == https://github.com/* || "$repo_input" == http://github.com/* ]]; then
    repo_input="${repo_input#*github.com/}"
  fi

  IFS='/' read -r owner repo _ <<< "$repo_input"
  if [ -z "$owner" ] || [ -z "$repo" ]; then
    echo "repo_url must be a GitHub repository slug or URL like owner/repo or https://github.com/owner/repo" >&2
    return 1
  fi

  printf 'https://github.com/%s/%s' "$owner" "$repo"
}

echo "🚀 GitNexus Runtime Starting..."

# Validate the runtime before doing any work.
node --version
npm --version
gitnexus --help >/dev/null

# Environment configuration
REPO_URL="${REPO_URL:?REPO_URL not set}"
BRANCH="${BRANCH:-main}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
REPO_PATH="/home/user/repo"
ANALYSIS_PATH="/home/user/analysis"

# Ensure directories exist
mkdir -p "$REPO_PATH" "$ANALYSIS_PATH"
cd "$REPO_PATH"

echo "📦 Step 1: Clone Repository"
echo "  Repository: $REPO_URL"
echo "  Branch: $BRANCH"

CANONICAL_REPO_URL="$(normalize_repo_url "$REPO_URL")"

if [ -z "$GITHUB_TOKEN" ]; then
  git clone --depth 50 --branch "$BRANCH" "$CANONICAL_REPO_URL" . || {
    echo "❌ Clone failed (public repo assumed)"
    exit 1
  }
else
  # Use token for private repos
  REPO_URL_WITH_TOKEN="${CANONICAL_REPO_URL/https:\/\/github.com/https://${GITHUB_TOKEN}@github.com}"
  git clone --depth 50 --branch "$BRANCH" "$REPO_URL_WITH_TOKEN" . || {
    echo "❌ Clone failed (check token and repo permissions)"
    exit 1
  }
fi

echo "✅ Repository cloned successfully"

echo "📊 Step 2: Run GitNexus Analysis"
cd "$REPO_PATH"

# Run GitNexus CLI to analyze repository
# Export analysis to JSON
gitnexus analyze \
  --repo "$REPO_PATH" \
  --output "$ANALYSIS_PATH/analysis.json" \
  --format json || {
  echo "⚠️  GitNexus analysis completed with status: $?"
}

echo "✅ Analysis complete"

# Output results
if [ -f "$ANALYSIS_PATH/analysis.json" ]; then
  echo ""
  echo "📈 Analysis Results:"
  cat "$ANALYSIS_PATH/analysis.json"
else
  echo "⚠️  No analysis output generated"
fi

echo "✅ GitNexus Runtime Complete"
