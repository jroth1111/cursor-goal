#!/usr/bin/env bash
# Install the cursor-goal safety-net hook into a repo. The agent-driver CLI does
# the heavy lifting; these hooks are a thin net (destructive-shell deny, evidence
# capture, interactive stop nudge) that fails open when the driver is absent.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SRC/.." && pwd)"
# shellcheck source=../scripts/lib/global-cli-flags.sh
source "$REPO_ROOT/scripts/lib/global-cli-flags.sh"
DEST=""

usage() { echo "Usage: bash core/install.sh [TARGET_REPO_ROOT]"; }

for arg in "$@"; do
  case "$arg" in
    --help|-h) cgr_show_help usage ;;
    --*) cgr_unknown_option "$arg" usage ;;
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
[[ -d "$DEST" ]] || { echo "Destination not found: $DEST" >&2; exit 1; }

echo "Installing cursor-goal safety net → $DEST"
mkdir -p "$DEST/.cursor/hooks" "$DEST/.cursor/goal/templates"

cp "$SRC/.cursor/hooks/safety-net.sh" "$DEST/.cursor/hooks/safety-net.sh"
chmod +x "$DEST/.cursor/hooks/safety-net.sh"

# shellcheck source=lib/merge-hooks-json.sh
source "$SRC/lib/merge-hooks-json.sh"
merge_hooks_json "$DEST/.cursor/hooks.json" "$SRC/.cursor/hooks.json.example"

cp "$SRC/.cursor/goal/templates/GOAL.md" "$DEST/.cursor/goal/templates/GOAL.md"
[[ -f "$SRC/.cursor/goal/.gitignore" ]] && cp "$SRC/.cursor/goal/.gitignore" "$DEST/.cursor/goal/.gitignore"

if [[ ! -f "$DEST/GOAL.md" ]]; then
  cp "$SRC/.cursor/goal/templates/GOAL.md" "$DEST/GOAL.md"
  echo "Created GOAL.md from template"
fi

echo "Done."
echo "Drive a goal headlessly:  agent-driver run \"<your goal>\""
echo "Or rely on the interactive stop-hook nudge once a run exists (agent-driver status)."
