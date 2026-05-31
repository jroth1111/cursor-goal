#!/usr/bin/env bash
# Remove cursor-goal global install from ~/.cursor
set -euo pipefail

PURGE_RUNTIME=0

usage() {
  echo "Usage: bash scripts/uninstall-global.sh [--purge-runtime]"
}

for arg in "$@"; do
  case "$arg" in
    --purge-runtime) PURGE_RUNTIME=1 ;;
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
LOCAL_BIN="${HOME}/.local/bin"

echo "Uninstalling cursor-goal global hooks from $CURSOR_HOME"

if [[ -d "$CURSOR_HOME/hooks" ]]; then
  find "$CURSOR_HOME/hooks" -maxdepth 1 \( -type f -o -type l \) \
    \( -name 'goal-*.sh' -o -name '_cgr-lib.sh' -o -name 'handlers-minimal.sh' -o -name 'verify-minimal.sh' \) \
    -delete
fi

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
            | select(((.command // "") | test("(^|/)goal-[^/]*$")) | not)
          ]
          | select((.value | length) > 0)
        else
          .
        end
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
