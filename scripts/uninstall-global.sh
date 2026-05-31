#!/usr/bin/env bash
# Remove cursor-goal global install from ~/.cursor
set -euo pipefail

PURGE_RUNTIME=0
for arg in "$@"; do
  case "$arg" in
    --purge-runtime) PURGE_RUNTIME=1 ;;
  esac
done

CURSOR_HOME="${CURSOR_HOME:-$HOME/.cursor}"
LOCAL_BIN="${HOME}/.local/bin"

GOAL_HOOKS=(
  goal-stop.sh
  goal-session-start.sh
  goal-prompt.sh
  goal-pre-tool.sh
  goal-shell.sh
  goal-post-tool.sh
  goal-subagent-stop.sh
  goal-session-end.sh
  _cgr-lib.sh
  handlers-minimal.sh
  verify-minimal.sh
)

echo "Uninstalling cursor-goal global hooks from $CURSOR_HOME"

for h in "${GOAL_HOOKS[@]}"; do
  rm -f "$CURSOR_HOME/hooks/$h"
done

if [[ -f "$CURSOR_HOME/hooks.json" ]] && command -v jq >/dev/null 2>&1; then
  tmp="$(mktemp)"
  jq '
    .hooks = (
      .hooks // {} |
      with_entries(
        select(
          (.value | type) != "array" or
          ([.value[]?.command // ""] | all(test("goal-") | not))
        )
      )
    )
  ' "$CURSOR_HOME/hooks.json" > "$tmp" && mv "$tmp" "$CURSOR_HOME/hooks.json"
  echo "Removed goal-* entries from hooks.json"
fi

rm -f "$LOCAL_BIN/cursor-goal" "$LOCAL_BIN/cursor-agent-goal"
rm -f "$CURSOR_HOME/cursor-goal.env"
rm -f "$CURSOR_HOME/cursor-goal/install-manifest.json"

if [[ "$PURGE_RUNTIME" -eq 1 ]]; then
  rm -rf "$CURSOR_HOME/cursor-goal-runtime"
  rm -rf "$CURSOR_HOME/goal/schemas" "$CURSOR_HOME/goal/templates"
  echo "Purged runtime and schemas"
fi

echo "Done. Restart Cursor to unload user hooks."
