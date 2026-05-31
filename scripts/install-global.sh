#!/usr/bin/env bash
# Install cursor-goal globally for cursor-agent (user hooks + runtime under ~/.cursor)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CORE_DIR="$REPO_ROOT/core"
RUNTIME_SRC="$REPO_ROOT/packages/cursor-goal-runtime"

SKIP_BUILD=0
WRITE_PROFILE=0
DRY_RUN=0

usage() {
  echo "Usage: bash scripts/install-global.sh [--skip-build] [--profile] [--dry-run]"
}

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --profile) WRITE_PROFILE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 1
      ;;
    *)
      echo "Unexpected argument: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

CURSOR_HOME="${CURSOR_HOME:-$HOME/.cursor}"
GLOBAL_RUNTIME="$CURSOR_HOME/cursor-goal-runtime"
GLOBAL_SCHEMAS="$CURSOR_HOME/goal/schemas"
GLOBAL_TEMPLATES="$CURSOR_HOME/goal/templates"
GLOBAL_HOOKS="$CURSOR_HOME/hooks"
GLOBAL_MANIFEST="$CURSOR_HOME/cursor-goal/install-manifest.json"
ENV_FILE="$CURSOR_HOME/cursor-goal.env"
LOCAL_BIN="${HOME}/.local/bin"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd node
require_cmd jq
require_cmd git
require_cmd bash

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "Node >= 22 required (found $(node -v))" >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "DRY RUN — would install to $CURSOR_HOME"
  mkdir -p "$CURSOR_HOME/cursor-goal"
  cat > "$GLOBAL_MANIFEST" <<EOF
{
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": "$REPO_ROOT",
  "runtime": "$GLOBAL_RUNTIME",
  "dry_run": true
}
EOF
  # shellcheck source=../core/lib/merge-hooks-json.sh
  source "$CORE_DIR/lib/merge-hooks-json.sh"
  merge_hooks_json "$CURSOR_HOME/hooks.json" "$CORE_DIR/.cursor/hooks.json.user.example"
  echo "Dry run complete — manifest at $GLOBAL_MANIFEST"
  exit 0
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "Building cursor-goal runtime..."
  (cd "$REPO_ROOT" && npm run build)
fi

if [[ ! -f "$RUNTIME_SRC/dist/hook-stop.mjs" ]]; then
  echo "Runtime not built: $RUNTIME_SRC/dist/hook-stop.mjs" >&2
  exit 1
fi

echo "Installing cursor-goal globally → $CURSOR_HOME"

mkdir -p "$GLOBAL_HOOKS" "$CURSOR_HOME/cursor-goal" "$LOCAL_BIN"
find "$GLOBAL_HOOKS" -maxdepth 1 -type f \
  \( -name 'goal-*.sh' -o -name '_cgr-lib.sh' -o -name 'handlers-minimal.sh' -o -name 'verify-minimal.sh' \) \
  -delete

# Runtime staging
rm -rf "$GLOBAL_RUNTIME"
mkdir -p "$GLOBAL_RUNTIME/dist"
cp -R "$RUNTIME_SRC/dist/." "$GLOBAL_RUNTIME/dist/"
cp "$RUNTIME_SRC/package.json" "$GLOBAL_RUNTIME/package.json"

# Production deps only (ajv, ajv-formats)
(
  cd "$GLOBAL_RUNTIME"
  npm install --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev
)

chmod +x "$GLOBAL_RUNTIME/dist/cli.js"

# Schemas + templates
rm -rf "$GLOBAL_SCHEMAS" "$GLOBAL_TEMPLATES"
mkdir -p "$GLOBAL_SCHEMAS" "$GLOBAL_TEMPLATES"
cp -R "$CORE_DIR/.cursor/goal/schemas/." "$GLOBAL_SCHEMAS/"
cp -R "$CORE_DIR/.cursor/goal/templates/." "$GLOBAL_TEMPLATES/"
cp "$CORE_DIR/.cursor/goal/.gitignore" "$CURSOR_HOME/goal/.gitignore" 2>/dev/null || true

# Hook scripts
for f in "$CORE_DIR/.cursor/hooks/"*; do
  base="$(basename "$f")"
  cp "$f" "$GLOBAL_HOOKS/$base"
  chmod +x "$GLOBAL_HOOKS/$base"
done

# User hooks.json merge
# shellcheck source=../core/lib/merge-hooks-json.sh
source "$CORE_DIR/lib/merge-hooks-json.sh"
merge_hooks_json "$CURSOR_HOME/hooks.json" "$CORE_DIR/.cursor/hooks.json.user.example"

# Env file for shells and wrappers
cat > "$ENV_FILE" <<EOF
# cursor-goal global install — source this file or use cursor-agent-goal wrapper
export CURSOR_GOAL_RUNTIME="$GLOBAL_RUNTIME"
export CURSOR_GOAL_SCHEMAS="$GLOBAL_SCHEMAS"
EOF
chmod 644 "$ENV_FILE"

# CLI symlinks
ln -sf "$GLOBAL_RUNTIME/dist/cli.js" "$LOCAL_BIN/cursor-goal"
ln -sf "$SCRIPT_DIR/cursor-agent-goal.sh" "$LOCAL_BIN/cursor-agent-goal"
chmod +x "$SCRIPT_DIR/cursor-agent-goal.sh"

# Manifest
GIT_SHA=""
if git -C "$REPO_ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
  GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
fi
cat > "$GLOBAL_MANIFEST" <<EOF
{
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": "$REPO_ROOT",
  "git_sha": "$GIT_SHA",
  "runtime": "$GLOBAL_RUNTIME",
  "schemas": "$GLOBAL_SCHEMAS",
  "hooks": "$GLOBAL_HOOKS"
}
EOF

if [[ "$WRITE_PROFILE" -eq 1 ]]; then
  SNIPPET="source \"$ENV_FILE\""
  for profile in "$HOME/.zshrc" "$HOME/.bashrc"; do
    if [[ -f "$profile" ]] && ! grep -qF "cursor-goal.env" "$profile" 2>/dev/null; then
      printf '\n# cursor-goal global\n%s\n' "$SNIPPET" >> "$profile"
      echo "Appended to $profile"
    fi
  done
fi

echo ""
echo "Global install complete."
echo "  Runtime:  $GLOBAL_RUNTIME"
echo "  Hooks:    $CURSOR_HOME/hooks.json"
echo "  CLI:      $LOCAL_BIN/cursor-goal"
echo "  Wrapper:  $LOCAL_BIN/cursor-agent-goal"
echo ""
echo "Next steps:"
echo "  1. Ensure $LOCAL_BIN is on PATH"
echo "  2. source $ENV_FILE   (or restart shell if --profile was used)"
echo "  3. cursor-goal doctor"
echo "  4. Restart Cursor / cursor-agent to reload user hooks"
