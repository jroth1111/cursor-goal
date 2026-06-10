#!/usr/bin/env bash
# Build agent-driver and zip a portable distribution bundle.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRIVER_PKG="$ROOT/packages/driver"
DIST_TMPL="$ROOT/scripts/dist"
OUT_DIR="$ROOT/dist"
VERSION="$(node -pe "require('$DRIVER_PKG/package.json').version")"
BUNDLE_NAME="agent-driver-${VERSION}"
STAGE="$OUT_DIR/$BUNDLE_NAME"
ZIP="$OUT_DIR/${BUNDLE_NAME}.zip"

echo "Building @cursor-goal/driver…"
( cd "$ROOT" && npm run build -w @cursor-goal/driver >/dev/null )

echo "Staging bundle → $STAGE"
if [[ -d "$STAGE" ]]; then
  mv "$STAGE" "${OUT_DIR}/${BUNDLE_NAME}.prev.$(date +%s)"
fi
mkdir -p "$STAGE/agent-driver" "$STAGE/lib" "$STAGE/core"

cp -R "$DRIVER_PKG/dist" "$STAGE/agent-driver/dist"
cp -R "$DRIVER_PKG/hooks" "$STAGE/agent-driver/hooks"
cp "$DRIVER_PKG/package.json" "$STAGE/agent-driver/package.json"

echo "Installing production node_modules into bundle…"
( cd "$STAGE/agent-driver" && npm install --omit=dev --no-audit --no-fund >/dev/null )

cp -R "$ROOT/core/.cursor" "$STAGE/core/"
cp "$DIST_TMPL/README.md" "$STAGE/README.md"
cp "$DIST_TMPL/install.sh" "$STAGE/install.sh"
cp "$DIST_TMPL/uninstall.sh" "$STAGE/uninstall.sh"
cp "$DIST_TMPL/install-repo.sh" "$STAGE/install-repo.sh"
cp "$ROOT/scripts/lib/global-cli-flags.sh" "$STAGE/lib/"
cp "$ROOT/core/lib/merge-hooks-json.sh" "$STAGE/lib/"
chmod +x "$STAGE/install.sh" "$STAGE/uninstall.sh" "$STAGE/install-repo.sh"

echo "Writing $ZIP"
( cd "$OUT_DIR" && zip -rq "$ZIP" "$BUNDLE_NAME" )

BYTES="$(wc -c < "$ZIP" | tr -d ' ')"
echo "Done: $ZIP (${BYTES} bytes)"
echo "Ship to target machine, then: unzip ${BUNDLE_NAME}.zip && cd ${BUNDLE_NAME} && bash install.sh --profile"
