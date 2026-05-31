#!/usr/bin/env bash
# Merge cursor-goal hook entries into a hooks.json file.
# shellcheck shell=bash
set -euo pipefail

# Usage: merge_hooks_json DEST_FILE EXAMPLE_FILE
merge_hooks_json() {
  local dest_file="$1"
  local example="$2"

  if [[ ! -f "$example" ]]; then
    echo "Example hooks.json not found: $example" >&2
    return 1
  fi

  if [[ ! -f "$dest_file" ]]; then
    cp "$example" "$dest_file"
    echo "Created $dest_file"
    return 0
  fi

  if ! command -v jq >/dev/null 2>&1; then
    echo "NOTE: $dest_file exists — merge manually from $example" >&2
    return 0
  fi

  local merged
  merged="$(jq -s '
    def flatten_hooks:
      if (.hooks.hooks? | type) == "object" then .hooks | flatten_hooks else . end;
    def merge_event_maps($base; $add):
      reduce ($add | keys[]) as $k ($base;
        if (has($k) and (.[$k] | type) == "array" and ($add[$k] | type) == "array") then
          .[$k] = (.[$k] + $add[$k] | unique_by(.command))
        else
          .[$k] = $add[$k]
        end
      );
    .[0] as $raw | .[1] as $example |
    ($raw | flatten_hooks) as $existing |
    {
      version: ($existing.version // $example.version // 1),
      hooks: merge_event_maps($existing.hooks // {}; $example.hooks // {})
    }
  ' "$dest_file" "$example")"
  echo "$merged" > "$dest_file"
  echo "Merged cursor-goal hooks into $dest_file"
}
