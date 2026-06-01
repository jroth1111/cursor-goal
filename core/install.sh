#!/usr/bin/env bash
# Install cursor-goal core into the current git repo (or cwd)
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SRC/.." && pwd)"
# shellcheck source=../scripts/lib/global-cli-flags.sh
source "$REPO_ROOT/scripts/lib/global-cli-flags.sh"
DEST=""
LOCAL_HOOKS=0

core_install_usage() {
  echo "Usage: bash core/install.sh [TARGET_REPO_ROOT] [--local-hooks]"
}

for arg in "$@"; do
  case "$arg" in
    --local-hooks) LOCAL_HOOKS=1 ;;
    --help|-h)
      cgr_show_help core_install_usage
      ;;
    --*)
      cgr_unknown_option "$arg" core_install_usage
      ;;
    *)
      if [[ -n "$DEST" ]]; then
        echo "Unexpected extra destination: $arg" >&2
        exit 1
      fi
      DEST="$arg"
      ;;
  esac
done

if [[ -z "$DEST" ]]; then
  DEST="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

if [[ ! -d "$DEST" ]]; then
  echo "Destination not found: $DEST" >&2
  exit 1
fi

GLOBAL_RT="${CURSOR_HOME:-$HOME/.cursor}/cursor-goal-runtime"
SKIP_HOOKS=0
if [[ "$LOCAL_HOOKS" -eq 0 ]] && [[ -f "$GLOBAL_RT/dist/hook-stop.mjs" ]]; then
  SKIP_HOOKS=1
  echo "Global cursor-goal runtime detected — skipping local hook copy (use --local-hooks to override)"
fi

echo "Installing cursor-goal core → $DEST"

mkdir -p "$DEST/.cursor/goal/templates"

if [[ "$SKIP_HOOKS" -eq 0 ]]; then
  mkdir -p "$DEST/.cursor/hooks"
  for f in "$SRC/.cursor/hooks/"*; do
    base="$(basename "$f")"
    cp "$f" "$DEST/.cursor/hooks/$base"
    chmod +x "$DEST/.cursor/hooks/$base"
  done

  # shellcheck source=lib/merge-hooks-json.sh
  source "$SRC/lib/merge-hooks-json.sh"
  merge_hooks_json "$DEST/.cursor/hooks.json" "$SRC/.cursor/hooks.json.example"
fi

# Templates & gitignore
cp "$SRC/.cursor/goal/templates/GOAL.md" "$DEST/.cursor/goal/templates/GOAL.md"
cp "$SRC/.cursor/goal/.gitignore" "$DEST/.cursor/goal/.gitignore"

if [[ ! -f "$DEST/GOAL.md" ]]; then
  cp "$SRC/.cursor/goal/templates/GOAL.md" "$DEST/GOAL.md"
  echo "Created GOAL.md from template"
fi

echo "Done."
if [[ "$SKIP_HOOKS" -eq 1 ]]; then
  echo "Hooks: using global install (~/.cursor/hooks.json). Per-repo override: bash core/install.sh --local-hooks"
else
  echo "Optional: npm run build for full verifier (or use global install)."
fi

RUNTIME_HINT=0
for candidate in \
  "$GLOBAL_RT/dist/hook-stop.mjs" \
  "$DEST/packages/cursor-goal-runtime/dist/hook-stop.mjs" \
  "$DEST/node_modules/@cursor-goal/runtime/dist/hook-stop.mjs"; do
  if [[ -f "$candidate" ]]; then
    RUNTIME_HINT=1
    break
  fi
done
if [[ "$RUNTIME_HINT" -eq 0 ]]; then
  echo "WARN: cursor-goal runtime not built; hooks will use fail-open minimal safety fallback until built (I38)." >&2
  echo "      Global: npm run install:global   Local: npm run build" >&2
  echo "      Then verify with: cursor-goal doctor" >&2
fi
