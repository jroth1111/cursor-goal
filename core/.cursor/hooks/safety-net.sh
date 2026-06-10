#!/usr/bin/env bash
# cursor-goal safety net — forwards the hook payload (stdin JSON) to agent-driver.
# One script serves all three events; the driver branches on hook_event_name:
#   preToolUse  -> deny destructive shell commands
#   postToolUse -> append a ground-truth evidence row
#   stop        -> nudge with the driver's next action (interactive only)
# Fails open: if the driver isn't installed, emit {} and never block the agent.
set -euo pipefail

proj="${CURSOR_PROJECT_DIR:-$PWD}"
candidates=(
  "${AGENT_DRIVER_HOOK:-}"
  "${CURSOR_HOME:-$HOME/.cursor}/agent-driver/dist/hooks/safety-net.js"
  "$proj/node_modules/@cursor-goal/driver/dist/hooks/safety-net.js"
  "$proj/packages/driver/dist/hooks/safety-net.js"
)

for c in "${candidates[@]}"; do
  if [[ -n "$c" && -f "$c" ]]; then
    exec node "$c"
  fi
done

echo '{}'
