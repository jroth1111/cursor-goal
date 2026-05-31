#!/usr/bin/env bash
# Minimal non-stop hooks — passthrough unless obvious block
set -euo pipefail

STEP="${1:-}"
INPUT="$(cat)"
ROOT="${CURSOR_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
GOAL_DIR="$ROOT/.cursor/goal"
mkdir -p "$GOAL_DIR/passports" "$GOAL_DIR/evidence"

destructive_shell() {
  local cmd="$1"
  if command -v perl >/dev/null 2>&1; then
    printf '%s' "$cmd" | perl -0777 -ne '
      exit 0 if /\bdrop\s+database\b/i;
      if (/\bgit\b[\s\S]*\bpush\b/i &&
          /(?:^|[\s;&|])(?:-f\b|--force(?:[=\s]|$)|--force-with-lease(?:[=\s]|$)|\+[^\s;&|]+)/i) { exit 0; }
      if (/(?:^|[\s;&|])rm(?:[\s;&|]|$)/i &&
          (/(?:^|[\s;&|])-[a-z]*r[a-z]*f[a-z]*(?=$|[\s;&|])/i ||
           /(?:^|[\s;&|])-[a-z]*f[a-z]*r[a-z]*(?=$|[\s;&|])/i ||
           /(?:^|[\s;&|])(?:-[a-z]*r[a-z]*|--recursive)(?=$|[\s;&|])[\s\S]*(?:^|[\s;&|])(?:-[a-z]*f[a-z]*|--force)(?=$|[\s;&|])/i ||
           /(?:^|[\s;&|])(?:-[a-z]*f[a-z]*|--force)(?=$|[\s;&|])[\s\S]*(?:^|[\s;&|])(?:-[a-z]*r[a-z]*|--recursive)(?=$|[\s;&|])/i)) { exit 0; }
      exit 1;
    '
    return $?
  fi
  printf '%s' "$cmd" | grep -qiE '\bdrop[[:space:]]+database\b|\bgit\b.*\bpush\b.*(--force([=[:space:]]|$)|--force-with-lease([=[:space:]]|$)|(^|[[:space:]])-f([[:space:]]|$)|(^|[[:space:];&|])\+[^[:space:];&|]+)|\brm\b.*(-[[:alpha:]]*r[[:alpha:]]*f|-[[:alpha:]]*f[[:alpha:]]*r|--recursive.*--force|--force.*--recursive)'
}

normalize_file_path() {
  local f="${1//\\//}"
  jq -nr --arg p "$f" '
    def norm($path):
      ($path | gsub("/+"; "/")) as $compact |
      ($compact | startswith("/")) as $abs |
      ($compact | split("/") | reduce .[] as $part
        ([];
          if $part == "" or $part == "." then .
          elif $part == ".." then
            if length > 0 and .[-1] != ".." then .[0:length - 1]
            elif $abs then .
            else . + [".."] end
          else . + [$part] end
        )) as $parts |
      (if $abs then "/" else "" end) + ($parts | join("/")) |
      if . == "" then (if $abs then "/" else "." end) else . end;
    norm($p)
  '
}

relative_file_path() {
  local f
  local r
  f="$(normalize_file_path "$1")"
  r="$(normalize_file_path "$ROOT")"
  if [[ "$f" == "$r" ]]; then
    printf '.'
  elif [[ "$f" == "$r/"* ]]; then
    printf '%s' "${f#"$r/"}"
  else
    printf '%s' "$f"
  fi
}

path_inside_project() {
  local f
  local r
  f="$(normalize_file_path "$1")"
  r="$(normalize_file_path "$ROOT")"
  if [[ "$f" == /* ]]; then
    [[ "$f" == "$r" || "$f" == "$r/"* ]]
    return
  fi
  [[ "$f" != ".." && "$f" != ../* ]]
}

unit_id_from_path() {
  local f
  f="$(normalize_file_path "$1")"
  printf '%s' "$f" | sed -nE 's|.*/evidence/units/([a-z0-9][a-z0-9_-]*)\.jsonl$|\1|Ip' | head -1
}

unit_evidence_path() {
  local f
  f="$(normalize_file_path "$1")"
  local id="$2"
  [[ "$id" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || return 1
  [[ -n "$id" && "$f" =~ (^|/)evidence/units/${id}\.jsonl$ ]]
}

case "$STEP" in
  sessionStart)
    if [[ ! -f "$ROOT/GOAL.md" ]] && [[ -f "$ROOT/.cursor/goal/templates/GOAL.md" ]]; then
      cp "$ROOT/.cursor/goal/templates/GOAL.md" "$ROOT/GOAL.md"
    fi
    if [[ ! -f "$GOAL_DIR/manifest.json" ]]; then
      LOOP_LIMIT=40
      if [[ -f "$ROOT/.cursor/hooks.json" ]]; then
        HL="$(jq -r '.hooks.stop[]? | select(.loop_limit != null) | .loop_limit' "$ROOT/.cursor/hooks.json" 2>/dev/null | head -1)"
        [[ -n "$HL" && "$HL" != "null" ]] && LOOP_LIMIT="$HL"
      fi
      echo "{\"goal_id\":\"default\",\"loop_limit\":$LOOP_LIMIT,\"runtime\":\"minimal\"}" > "$GOAL_DIR/manifest.json"
    fi
    if [[ ! -f "$GOAL_DIR/trajectory.json" ]]; then
      echo '{"phase":"DISCOVERY"}' > "$GOAL_DIR/trajectory.json"
    fi
    echo '{}'
    ;;
  beforeSubmitPrompt)
    # Minimal path: auto default — no GOAL required (full runtime does triage).
    if [[ -f "$GOAL_DIR/PAUSED" ]]; then
      jq -n --arg u "Goal paused (.cursor/goal/PAUSED). Remove file or run: rm .cursor/goal/PAUSED" \
        '{continue:true,agent_message:$u}'
      exit 0
    fi
    echo '{"continue":true}'
    ;;
  preToolUse)
    TOOL="$(echo "$INPUT" | jq -r '.tool_name // empty')"
    FILE="$(echo "$INPUT" | jq -r '.file_path // .tool_input.path // empty')"
    IS_SUB="$(echo "$INPUT" | jq -r '.is_subagent // false')"
    if [[ "$TOOL" == "Shell" || "$TOOL" == "Bash" ]]; then
      CMD="$(echo "$INPUT" | jq -r '.command // .tool_input.command // empty')"
      if destructive_shell "$CMD"; then
        jq -n --arg m "Destructive shell blocked by cursor-goal minimal policy." \
          '{permission:"deny",agent_message:$m}'
        exit 0
      fi
    fi
    if [[ "$IS_SUB" == "true" ]] && echo "$FILE" | grep -qE '\.cursor/goal'; then
      WUID="$(echo "$INPUT" | jq -r '.work_unit_id // .tool_input.work_unit_id // empty')"
      [[ -z "$WUID" ]] && WUID="$(unit_id_from_path "$FILE")"
      if unit_evidence_path "$FILE" "$WUID"; then
        echo '{"permission":"allow"}'
        exit 0
      fi
      jq -n --arg m "Subagents may only write evidence/units/<id>.jsonl under .cursor/goal" \
        '{permission:"deny",agent_message:$m}'
      exit 0
    fi
    if [[ "$IS_SUB" == "true" ]] && [[ -n "$FILE" ]] && [[ "$TOOL" == "Write" || "$TOOL" == "Edit" || "$TOOL" == "MultiEdit" ]] && [[ -f "$GOAL_DIR/work-units.json" ]]; then
      WUID="$(echo "$INPUT" | jq -r '.work_unit_id // .tool_input.work_unit_id // empty')"
      if ! path_inside_project "$FILE"; then
        jq -n --arg m "Subagent WriteGate: $FILE outside project root" \
          '{permission:"deny",agent_message:$m}'
        exit 0
      fi
      REL_FILE="$(relative_file_path "$FILE")"
      if [[ -z "$WUID" ]]; then
        WUID="$(unit_id_from_path "$REL_FILE")"
      fi
      if [[ -n "$WUID" ]]; then
        if unit_evidence_path "$REL_FILE" "$WUID"; then
          echo '{"permission":"allow"}'
          exit 0
        fi
        IN_UNIT="$(jq -r --arg id "$WUID" --arg f "$REL_FILE" '
          .units[]? | select(.id == $id) | .scope[]? as $p |
          ($p | gsub("\\\\"; "/") | split("/") | reduce .[] as $part ([];
            if $part == "" or $part == "." then .
            elif $part == ".." then
              if length > 0 and .[-1] != ".." then .[0:length - 1]
              else . + [".."] end
            else . + [$part] end
          ) | join("/") | rtrimstr("/")) as $base |
          if $base == "**" or $base == "." or $base == "" or $f == $base or ($f | startswith($base + "/")) then "yes" else empty end
        ' "$GOAL_DIR/work-units.json" 2>/dev/null | head -1)"
        if [[ "$IN_UNIT" != "yes" ]]; then
          jq -n --arg m "Subagent WriteGate: $FILE outside unit $WUID scope" \
            '{permission:"deny",agent_message:$m}'
          exit 0
        fi
      elif ! unit_evidence_path "$REL_FILE" "$(unit_id_from_path "$REL_FILE")"; then
        jq -n --arg m "Subagent WriteGate: missing work_unit_id — cannot verify unit scope" \
          '{permission:"deny",agent_message:$m}'
        exit 0
      fi
    fi
    echo '{"permission":"allow"}'
    ;;
  beforeShellExecution)
    # Minimal mode is fail-open except for narrowly destructive commands.
    CMD="$(echo "$INPUT" | jq -r '.command // empty')"
    if destructive_shell "$CMD"; then
      jq -n --arg m "Destructive shell blocked by cursor-goal minimal policy." \
        '{permission:"deny",agent_message:$m}'
      exit 0
    fi
    echo '{"permission":"allow"}'
    ;;
  postToolUse)
    TOOL="$(echo "$INPUT" | jq -r '.tool_name // empty')"
    if [[ "$TOOL" == "Write" || "$TOOL" == "Edit" || "$TOOL" == "MultiEdit" ]]; then
      echo "{\"last_edit_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$GOAL_DIR/state.json"
    fi
    if [[ "$TOOL" == "Shell" ]]; then
      OUT="$(echo "$INPUT" | jq -r '.tool_output // empty' | head -c 500)"
      echo "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"tool\":\"Shell\",\"excerpt\":$(jq -Rn --arg x "$OUT" '$x')}" \
        >> "$GOAL_DIR/evidence/ledger.jsonl"
    fi
    echo '{}'
    ;;
  subagentStop)
    echo "$INPUT" | jq -c --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '. + {at: $at}' \
      >> "$GOAL_DIR/evidence/subagents.jsonl" 2>/dev/null || true
    echo '{}'
    ;;
  sessionEnd)
    if [[ ! -f "$GOAL_DIR/passports/RELEASE.json" ]] && [[ ! -f "$GOAL_DIR/passports/SESSION_END.json" ]]; then
      echo '{"status":"SESSION_END","reason":"session_end_without_release"}' > "$GOAL_DIR/passports/SESSION_END.json"
    fi
    echo '{}'
    ;;
  *)
    echo '{}'
    ;;
esac
