#!/usr/bin/env bash
# Remove the agent-driver global install from ~/.cursor.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/global-cli-flags.sh
source "$SCRIPT_DIR/lib/global-cli-flags.sh"

usage() { echo "Usage: bash scripts/uninstall-global.sh"; }

for arg in "$@"; do
  case "$arg" in
    --help|-h) cgr_show_help usage ;;
    --*) cgr_unknown_option "$arg" usage ;;
    *) cgr_unexpected_argument "$arg" usage ;;
  esac
done

CURSOR_HOME="${CURSOR_HOME:-$HOME/.cursor}"

echo "Uninstalling agent-driver from $CURSOR_HOME"

# Drop our safety-net entries (and any legacy goal-* entries) from hooks.json.
if [[ -f "$CURSOR_HOME/hooks.json" ]] && command -v jq >/dev/null 2>&1; then
  tmp="$(mktemp)"
  jq '
    def flatten_hooks:
      if (.hooks.hooks? | type) == "object" then .hooks | flatten_hooks else . end;
    .hooks = (
      flatten_hooks |
      .hooks // {} |
      with_entries(
        if (.value | type) == "array" then
          .value = [
            .value[]?
            | select(((.command // "") | test("(safety-net\\.js|(^|/)goal-[^/]*$)")) | not)
          ]
          | select((.value | length) > 0)
        else
          .
        end
      )
    )
  ' "$CURSOR_HOME/hooks.json" > "$tmp" && mv "$tmp" "$CURSOR_HOME/hooks.json"
  echo "Removed agent-driver entries from hooks.json"
fi

rm -f "$CURSOR_HOME/bin/agent-driver"
rm -rf "$CURSOR_HOME/agent-driver"
rm -f "$CURSOR_HOME/cursor-goal.env"

echo "Done. Restart Cursor to unload user hooks."
