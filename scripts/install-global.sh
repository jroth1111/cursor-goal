#!/usr/bin/env bash
# Install agent-driver globally: build it, stage it under ~/.cursor/agent-driver
# (with its runtime dep), symlink the CLI onto ~/.cursor/bin, and register the
# 3-event safety-net hook in the global ~/.cursor/hooks.json.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/global-cli-flags.sh
source "$SRC/scripts/lib/global-cli-flags.sh"

CURSOR_HOME="${CURSOR_HOME:-$HOME/.cursor}"
DEST="$CURSOR_HOME/agent-driver"
BIN_DIR="$CURSOR_HOME/bin"
PROFILE=0

usage() { echo "Usage: npm run install:global [-- --profile]"; }

for arg in "$@"; do
  case "$arg" in
    --profile) PROFILE=1 ;;
    --help|-h) cgr_show_help usage ;;
    --*) cgr_unknown_option "$arg" usage ;;
    *) cgr_unexpected_argument "$arg" usage ;;
  esac
done

echo "Building agent-driver…"
( cd "$SRC" && npm run build -w @cursor-goal/driver >/dev/null )

echo "Staging agent-driver → $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/packages/driver/dist" "$DEST/dist"
cp -R "$SRC/packages/driver/hooks" "$DEST/hooks"
cp "$SRC/packages/driver/package.json" "$DEST/package.json"
( cd "$DEST" && npm install --omit=dev --no-audit --no-fund >/dev/null )
chmod +x "$DEST/dist/cli.js"

echo "Linking CLI → $BIN_DIR/agent-driver"
mkdir -p "$BIN_DIR"
ln -sf "$DEST/dist/cli.js" "$BIN_DIR/agent-driver"

echo "Registering global safety-net hook"
HOOK_JS="$DEST/dist/hooks/safety-net.js"
EXAMPLE="$(mktemp)"
trap 'rm -f "$EXAMPLE"' EXIT
cat > "$EXAMPLE" <<JSON
{
  "version": 1,
  "hooks": {
    "preToolUse": [{ "command": "node $HOOK_JS" }],
    "postToolUse": [{ "command": "node $HOOK_JS" }],
    "stop": [{ "command": "node $HOOK_JS", "loop_limit": 40, "timeout": 120 }]
  }
}
JSON
# shellcheck source=../core/lib/merge-hooks-json.sh
source "$SRC/core/lib/merge-hooks-json.sh"
merge_hooks_json "$CURSOR_HOME/hooks.json" "$EXAMPLE"

if [[ "$PROFILE" -eq 1 ]]; then
  ENV_FILE="$CURSOR_HOME/cursor-goal.env"
  echo "export PATH=\"$BIN_DIR:\$PATH\"" > "$ENV_FILE"
  echo "Wrote $ENV_FILE — source it from your shell profile for the agent-driver CLI."
fi

echo "Done. Verify with: agent-driver doctor"
if [[ "$PROFILE" -eq 0 ]]; then
  echo "Tip: add $BIN_DIR to PATH (or run with --profile) to call 'agent-driver' directly."
fi
