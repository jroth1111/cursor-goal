#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/_cgr-lib.sh"
cgr_dispatch subagentStop
