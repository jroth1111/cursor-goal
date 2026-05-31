#!/usr/bin/env bash
# cursor-agent with cursor-goal global env loaded
set -euo pipefail

ENV_FILE="${CURSOR_HOME:-$HOME/.cursor}/cursor-goal.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

AGENT="${CURSOR_AGENT_BIN:-cursor-agent}"
exec "$AGENT" "$@"
