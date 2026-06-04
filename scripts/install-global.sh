#!/usr/bin/env bash
# Install cursor-goal globally for cursor-agent (user hooks + runtime under ~/.cursor)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/global-cli-flags.sh
source "$SCRIPT_DIR/lib/global-cli-flags.sh"
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
    --help|-h) cgr_show_help usage ;;
    --*) cgr_unknown_option "$arg" usage ;;
    *) cgr_unexpected_argument "$arg" usage ;;
  esac
done

CURSOR_HOME="${CURSOR_HOME:-$HOME/.cursor}"
GLOBAL_RUNTIME="$CURSOR_HOME/cursor-goal-runtime"
GLOBAL_SCHEMAS="$CURSOR_HOME/goal/schemas"
GLOBAL_TEMPLATES="$CURSOR_HOME/goal/templates"
GLOBAL_HOOKS="$CURSOR_HOME/hooks"
GLOBAL_MANIFEST="$CURSOR_HOME/cursor-goal/install-manifest.json"
VERIFY_REPORT="$CURSOR_HOME/cursor-goal/install-verify.json"
ROLLBACK_ARCHIVE="$CURSOR_HOME/cursor-goal/install-rollback.tgz"
ENV_FILE="$CURSOR_HOME/cursor-goal.env"
LOCAL_BIN="${HOME}/.local/bin"
INSTALL_ROLLBACK_READY=0

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

GIT_SHA=""
if git -C "$REPO_ROOT" rev-parse --short HEAD >/dev/null 2>&1; then
  GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
fi
SOURCE_TREE=""
SOURCE_DIRTY=false
SOURCE_DIRTY_FILES='[]'

refresh_source_metadata() {
  local meta
  if [[ ! -f "$SCRIPT_DIR/source-metadata.mjs" ]]; then
    SOURCE_TREE="$GIT_SHA"
    SOURCE_DIRTY=false
    SOURCE_DIRTY_FILES='[]'
    return 0
  fi
  meta="$(node "$SCRIPT_DIR/source-metadata.mjs" "$REPO_ROOT")"
  SOURCE_TREE="$(jq -r '.source_tree // ""' <<<"$meta")"
  SOURCE_DIRTY="$(jq -r '.source_dirty // false' <<<"$meta")"
  SOURCE_DIRTY_FILES="$(jq -c '.source_dirty_files // []' <<<"$meta")"
}

write_install_manifest() {
  local dry_run="${1:-0}"
  local installed_at
  installed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$dry_run" -eq 1 ]]; then
    jq -n \
      --arg installed_at "$installed_at" \
      --arg source "$REPO_ROOT" \
      --arg git_sha "$GIT_SHA" \
      --arg source_tree "$SOURCE_TREE" \
      --argjson source_dirty "$SOURCE_DIRTY" \
      --argjson source_dirty_files "$SOURCE_DIRTY_FILES" \
      --arg runtime "$GLOBAL_RUNTIME" \
      --arg schemas "$GLOBAL_SCHEMAS" \
      --arg templates "$GLOBAL_TEMPLATES" \
      --arg hooks "$GLOBAL_HOOKS" \
      '{
        installed_at: $installed_at,
        source: $source,
        git_sha: $git_sha,
        source_tree: $source_tree,
        source_dirty: $source_dirty,
        source_dirty_files: $source_dirty_files,
        runtime: $runtime,
        schemas: $schemas,
        templates: $templates,
        hooks: $hooks,
        dry_run: true
      }' > "$GLOBAL_MANIFEST"
  else
    jq -n \
      --arg installed_at "$installed_at" \
      --arg source "$REPO_ROOT" \
      --arg git_sha "$GIT_SHA" \
      --arg source_tree "$SOURCE_TREE" \
      --argjson source_dirty "$SOURCE_DIRTY" \
      --argjson source_dirty_files "$SOURCE_DIRTY_FILES" \
      --arg runtime "$GLOBAL_RUNTIME" \
      --arg schemas "$GLOBAL_SCHEMAS" \
      --arg templates "$GLOBAL_TEMPLATES" \
      --arg hooks "$GLOBAL_HOOKS" \
      '{
        installed_at: $installed_at,
        source: $source,
        git_sha: $git_sha,
        source_tree: $source_tree,
        source_dirty: $source_dirty,
        source_dirty_files: $source_dirty_files,
        runtime: $runtime,
        schemas: $schemas,
        templates: $templates,
        hooks: $hooks
      }' > "$GLOBAL_MANIFEST"
  fi
}

copy_runtime_dep_tree() {
  local dep="$1"
  local src="$REPO_ROOT/node_modules/$dep"
  local dst="$GLOBAL_RUNTIME/node_modules/$dep"
  if [[ -d "$src" && ! -e "$dst" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp -R "$src" "$dst"
  fi
}

ensure_runtime_node_deps() {
  if (cd "$GLOBAL_RUNTIME" && node -e 'require.resolve("ajv"); require.resolve("ajv-formats")' >/dev/null 2>&1); then
    return 0
  fi
  for dep in ajv ajv-formats fast-deep-equal fast-uri json-schema-traverse require-from-string; do
    copy_runtime_dep_tree "$dep"
  done
}

delete_managed_global_hooks() {
  [[ -d "$GLOBAL_HOOKS" ]] || return 0
  find "$GLOBAL_HOOKS" -maxdepth 1 \( -type f -o -type l \) \
    \( -name 'goal-*.sh' -o -name '_cgr-lib.sh' -o -name 'handlers-minimal.sh' -o -name 'verify-minimal.sh' -o -name 'destructive-shell-policy.sh' \) \
    -delete
}

snapshot_install_path() {
  local src="$1"
  local rel="$2"
  local stage_root="$3"
  if [[ -e "$src" || -L "$src" ]]; then
    mkdir -p "$stage_root/$(dirname "$rel")"
    cp -R "$src" "$stage_root/$rel"
  fi
}

create_install_rollback_snapshot() {
  local stage
  stage="$CURSOR_HOME/cursor-goal/install-rollback.staging"
  rm -rf "$stage"
  mkdir -p "$stage/root" "$CURSOR_HOME/cursor-goal"
  snapshot_install_path "$GLOBAL_RUNTIME" "cursor-goal-runtime" "$stage/root"
  snapshot_install_path "$GLOBAL_SCHEMAS" "goal/schemas" "$stage/root"
  snapshot_install_path "$GLOBAL_TEMPLATES" "goal/templates" "$stage/root"
  snapshot_install_path "$GLOBAL_HOOKS" "hooks" "$stage/root"
  snapshot_install_path "$GLOBAL_MANIFEST" "cursor-goal/install-manifest.json" "$stage/root"
  snapshot_install_path "$VERIFY_REPORT" "cursor-goal/install-verify.json" "$stage/root"
  snapshot_install_path "$ENV_FILE" "cursor-goal.env" "$stage/root"
  (cd "$stage/root" && tar -czf "$ROLLBACK_ARCHIVE" .)
  rm -rf "$stage"
  INSTALL_ROLLBACK_READY=1
}

restore_install_rollback_snapshot() {
  local exit_code="$?"
  set +e
  if [[ "$INSTALL_ROLLBACK_READY" -eq 1 && -f "$ROLLBACK_ARCHIVE" ]]; then
    echo "Install failed; restoring previous cursor-goal global install from $ROLLBACK_ARCHIVE" >&2
    rm -rf "$GLOBAL_RUNTIME" "$GLOBAL_SCHEMAS" "$GLOBAL_TEMPLATES"
    delete_managed_global_hooks
    rm -f "$GLOBAL_MANIFEST" "$VERIFY_REPORT" "$ENV_FILE"
    tar -xzf "$ROLLBACK_ARCHIVE" -C "$CURSOR_HOME"
  fi
  exit "$exit_code"
}

verify_global_install() {
  local runtime_ok=false
  local manifest_ok=false
  local schemas_ok=false
  local templates_ok=false
  local hooks_ok=true
  local hook_resolution_ok=false
  local runtime_cli_smoke_ok=false
  local runtime_hook_smoke_ok=false
  local resolved_runtime=""
  local tmp_project=""
  local ok=false

  [[ -f "$GLOBAL_RUNTIME/dist/hook-stop.mjs" && -f "$GLOBAL_RUNTIME/dist/cli.js" && -f "$GLOBAL_RUNTIME/package.json" ]] && runtime_ok=true
  if jq -e \
    --arg sha "$GIT_SHA" \
    --arg source_tree "$SOURCE_TREE" \
    --argjson source_dirty "$SOURCE_DIRTY" \
    --argjson source_dirty_files "$SOURCE_DIRTY_FILES" \
    --arg rt "$GLOBAL_RUNTIME" \
    --arg schemas "$GLOBAL_SCHEMAS" \
    --arg templates "$GLOBAL_TEMPLATES" \
    --arg hooks "$GLOBAL_HOOKS" \
    '.git_sha == $sha and .source_tree == $source_tree and .source_dirty == $source_dirty and .source_dirty_files == $source_dirty_files and .runtime == $rt and .schemas == $schemas and .templates == $templates and .hooks == $hooks' \
    "$GLOBAL_MANIFEST" >/dev/null 2>&1; then
    manifest_ok=true
  fi
  if diff -qr "$CORE_DIR/.cursor/goal/schemas" "$GLOBAL_SCHEMAS" >/dev/null 2>&1; then
    schemas_ok=true
  fi
  if diff -qr "$CORE_DIR/.cursor/goal/templates" "$GLOBAL_TEMPLATES" >/dev/null 2>&1; then
    templates_ok=true
  fi
  for f in "$CORE_DIR/.cursor/hooks/"*; do
    local base
    base="$(basename "$f")"
    if ! cmp -s "$f" "$GLOBAL_HOOKS/$base"; then
      hooks_ok=false
      break
    fi
  done

  tmp_project="$(mktemp -d "${TMPDIR:-/tmp}/cgr-install-verify.XXXXXX")"
  resolved_runtime="$(env -u CURSOR_GOAL_RUNTIME CURSOR_PROJECT_DIR="$tmp_project" CURSOR_HOME="$CURSOR_HOME" HOME="$HOME" bash -c 'source "$1/_cgr-lib.sh" && cgr_resolve_runtime' bash "$GLOBAL_HOOKS" 2>/dev/null || true)"
  rm -rf "$tmp_project"
  if [[ "$resolved_runtime" == "$GLOBAL_RUNTIME" ]]; then
    hook_resolution_ok=true
  fi

  if env -u NODE_PATH CURSOR_HOME="$CURSOR_HOME" HOME="$HOME" node "$GLOBAL_RUNTIME/dist/cli.js" --help >/dev/null 2>&1; then
    runtime_cli_smoke_ok=true
  fi
  tmp_project="$(mktemp -d "${TMPDIR:-/tmp}/cgr-install-hook-smoke.XXXXXX")"
  if env -u NODE_PATH CURSOR_PROJECT_DIR="$tmp_project" CURSOR_HOME="$CURSOR_HOME" HOME="$HOME" \
    node "$GLOBAL_RUNTIME/dist/hook-stop.mjs" >/dev/null 2>&1 <<< '{"status":"completed","loop_count":0}'; then
    runtime_hook_smoke_ok=true
  fi
  rm -rf "$tmp_project"

  if [[ "$runtime_ok" == true && "$manifest_ok" == true && "$schemas_ok" == true && "$templates_ok" == true && "$hooks_ok" == true && "$hook_resolution_ok" == true && "$runtime_cli_smoke_ok" == true && "$runtime_hook_smoke_ok" == true ]]; then
    ok=true
  fi

  jq -n \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg runtime "$GLOBAL_RUNTIME" \
    --arg resolved_runtime "$resolved_runtime" \
    --argjson ok "$ok" \
    --argjson runtime_ok "$runtime_ok" \
    --argjson manifest_ok "$manifest_ok" \
    --argjson schemas_ok "$schemas_ok" \
    --argjson templates_ok "$templates_ok" \
    --argjson hooks_ok "$hooks_ok" \
    --argjson hook_resolution_ok "$hook_resolution_ok" \
    --argjson runtime_cli_smoke_ok "$runtime_cli_smoke_ok" \
    --argjson runtime_hook_smoke_ok "$runtime_hook_smoke_ok" \
    '{
      verified_at: $at,
      ok: $ok,
      runtime: $runtime,
      resolved_runtime: $resolved_runtime,
      checks: {
        runtime_files: { ok: $runtime_ok },
        manifest_git_sha: { ok: $manifest_ok },
        schemas: { ok: $schemas_ok },
        templates: { ok: $templates_ok },
        hooks: { ok: $hooks_ok },
        hook_resolution: { ok: $hook_resolution_ok },
        runtime_cli_smoke: { ok: $runtime_cli_smoke_ok },
        runtime_hook_smoke: { ok: $runtime_hook_smoke_ok }
      }
    }' > "$VERIFY_REPORT"

  if [[ "$ok" != true ]]; then
    echo "Post-install verification failed — report: $VERIFY_REPORT" >&2
    cat "$VERIFY_REPORT" >&2
    exit 1
  fi
  echo "Post-install verification complete — report: $VERIFY_REPORT"
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "DRY RUN — would install to $CURSOR_HOME"
  mkdir -p "$CURSOR_HOME/cursor-goal"
  refresh_source_metadata
  write_install_manifest 1
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

refresh_source_metadata

if [[ ! -f "$RUNTIME_SRC/dist/hook-stop.mjs" ]]; then
  echo "Runtime not built: $RUNTIME_SRC/dist/hook-stop.mjs" >&2
  exit 1
fi

echo "Installing cursor-goal globally → $CURSOR_HOME"

mkdir -p "$GLOBAL_HOOKS" "$CURSOR_HOME/cursor-goal" "$LOCAL_BIN"
create_install_rollback_snapshot
trap restore_install_rollback_snapshot ERR
delete_managed_global_hooks

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
ensure_runtime_node_deps

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

write_install_manifest 0
verify_global_install
trap - ERR

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
