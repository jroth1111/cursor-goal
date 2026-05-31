#!/usr/bin/env bash
# Minimal non-stop hooks — passthrough unless obvious block
set -euo pipefail

STEP="${1:-}"
INPUT="$(cat)"
ROOT="${CURSOR_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
GOAL_DIR="$ROOT/.cursor/goal"
mkdir -p "$GOAL_DIR/passports" "$GOAL_DIR/evidence"

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
      if echo "$CMD" | grep -qiE '\brm[[:space:]]+-rf\b|\bgit[[:space:]]+push[[:space:]]+--force\b|\bdrop[[:space:]]+database\b'; then
        jq -n --arg m "Destructive shell blocked by cursor-goal minimal policy." \
          '{permission:"deny",agent_message:$m}'
        exit 0
      fi
    fi
    if [[ "$IS_SUB" == "true" ]] && echo "$FILE" | grep -qE '\.cursor/goal'; then
      if echo "$FILE" | grep -qE 'evidence/units/'; then
        echo '{"permission":"allow"}'
        exit 0
      fi
      jq -n --arg m "Subagents may only write evidence/units/<id>.jsonl under .cursor/goal" \
        '{permission:"deny",agent_message:$m}'
      exit 0
    fi
    if [[ "$IS_SUB" == "true" ]] && [[ -n "$FILE" ]] && [[ "$TOOL" == "Write" || "$TOOL" == "Edit" || "$TOOL" == "MultiEdit" ]] && [[ -f "$GOAL_DIR/work-units.json" ]]; then
      WUID="$(echo "$INPUT" | jq -r '.work_unit_id // empty')"
      if [[ -z "$WUID" ]] && echo "$FILE" | grep -qE 'evidence/units/'; then
        WUID="$(echo "$FILE" | sed -nE 's|.*/evidence/units/([a-z0-9][a-z0-9_-]*).*|\1|p' | head -1)"
      fi
      if [[ -n "$WUID" ]]; then
        IN_UNIT="$(jq -r --arg id "$WUID" --arg f "$FILE" '
          .units[]? | select(.id == $id) | .scope[]? as $p |
          if ($f | startswith($p)) or ($f == ($p | rtrimstr("/"))) or ($f | contains("evidence/units/" + $id)) then "yes" else empty end
        ' "$GOAL_DIR/work-units.json" 2>/dev/null | head -1)"
        if [[ "$IN_UNIT" != "yes" ]] && ! echo "$FILE" | grep -qE 'evidence/units/'; then
          jq -n --arg m "Subagent WriteGate: $FILE outside unit $WUID scope" \
            '{permission:"deny",agent_message:$m}'
          exit 0
        fi
      elif ! echo "$FILE" | grep -qE 'evidence/units/'; then
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
    if echo "$CMD" | grep -qiE '\brm[[:space:]]+-rf\b|\bgit[[:space:]]+push[[:space:]]+--force\b|\bdrop[[:space:]]+database\b'; then
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
