#!/usr/bin/env bash
# cursor-goal: stop hook — auto-continue via followup_message (cursor-agent native loop)
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/_cgr-lib.sh"
cgr_dispatch stop
