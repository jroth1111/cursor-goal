#!/usr/bin/env bash
# cursor-goal: stop hook — verifier/release gate; queued followups are explicit opt-in
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/_cgr-lib.sh"
cgr_dispatch stop
