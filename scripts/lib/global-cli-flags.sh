#!/usr/bin/env bash
# Shared CLI flag helpers for cursor-goal install scripts.
# Source from install/uninstall scripts; do not execute directly.

cgr_unknown_option() {
  local opt="$1"
  local usage_fn="${2:-}"
  echo "Unknown option: $opt" >&2
  if [[ -n "$usage_fn" ]] && declare -F "$usage_fn" >/dev/null 2>&1; then
    "$usage_fn" >&2
  fi
  exit 1
}

cgr_unexpected_argument() {
  local arg="$1"
  local usage_fn="${2:-}"
  echo "Unexpected argument: $arg" >&2
  if [[ -n "$usage_fn" ]] && declare -F "$usage_fn" >/dev/null 2>&1; then
    "$usage_fn" >&2
  fi
  exit 1
}

cgr_show_help() {
  local usage_fn="$1"
  if declare -F "$usage_fn" >/dev/null 2>&1; then
    "$usage_fn"
  fi
  exit 0
}
