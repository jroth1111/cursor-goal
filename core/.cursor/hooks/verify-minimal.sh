#!/usr/bin/env bash
# Minimal stop verifier — no npm package required. Reads GOAL.md ## Checks
set -euo pipefail

STEP="${1:-stop}"
if [[ "$STEP" != "stop" ]]; then
  echo '{}'
  exit 0
fi

INPUT="$(cat)"
STATUS="$(echo "$INPUT" | jq -r '.status // "unknown"')"
CURSOR_LOOP="$(echo "$INPUT" | jq -r '.loop_count // 0')"
CONV_ID="$(echo "$INPUT" | jq -r '.conversation_id // "default"')"
ROOT="${CURSOR_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$ROOT"

GOAL_DIR=".cursor/goal"
PASSPORTS="$GOAL_DIR/passports"
GOAL_LOOP_FILE="$GOAL_DIR/goal-loop.json"
STATE_FILE="$GOAL_DIR/runtime-state.json"
LOCK_DIR="$GOAL_DIR/.lock"
AGENT_ID="$(printf '%s' "$CONV_ID" | tr -c '[:alnum:]_-' '_' | head -c 120)"
[[ -z "$AGENT_ID" ]] && AGENT_ID="default"
AGENT_DIR="$GOAL_DIR/agents/$AGENT_ID"
AGENT_STATE="$AGENT_DIR/runtime-state.json"
mkdir -p "$PASSPORTS" "$GOAL_DIR/evidence" "$AGENT_DIR"

if [[ -f "$GOAL_DIR/PAUSED" ]]; then
  echo '{}'
  exit 0
fi

if [[ "$STATUS" != "completed" ]]; then
  echo '{}'
  exit 0
fi

LOOP_LIMIT=40
if [[ -f "$ROOT/.cursor/hooks.json" ]]; then
  HL="$(jq -r '.hooks.stop[]? | select(.loop_limit != null) | .loop_limit' "$ROOT/.cursor/hooks.json" 2>/dev/null | head -1)"
  [[ -n "$HL" && "$HL" != "null" ]] && LOOP_LIMIT="$HL"
fi
if [[ -f "$GOAL_DIR/manifest.json" ]]; then
  ML="$(jq -r '.loop_limit // empty' "$GOAL_DIR/manifest.json")"
  [[ -n "$ML" ]] && LOOP_LIMIT="$ML"
fi

goal_loop_line() {
  local goal="$1" limit="$2" cursor="$3" repo="$4"
  local line
  if [[ "$cursor" -ge 0 ]] && [[ "$cursor" -ne "$goal" ]]; then
    line="$(printf 'GOAL loop %s/%s [minimal] (agent stop %s/%s)' "$goal" "$limit" "$cursor" "$limit")"
  else
    line="$(printf 'GOAL loop %s/%s [minimal]' "$goal" "$limit")"
  fi
  if [[ -n "$repo" ]] && [[ "$repo" != "$goal" ]]; then
    printf '%s (repo %s/%s)' "$line" "$repo" "$limit"
  else
    printf '%s' "$line"
  fi
}

with_goal_lock() {
  # Break stale locks left by crashed processes (>30s old).
  if [[ -d "$LOCK_DIR" ]]; then
    local lock_mtime now lock_age
    lock_mtime="$(stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0)"
    now="$(date +%s)"
    lock_age=$(( now - lock_mtime ))
    if [[ "$lock_age" -gt 30 ]]; then
      rm -rf "$LOCK_DIR" 2>/dev/null || true
    fi
  fi
  local i=0
  while [[ $i -lt 50 ]]; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      # Always release the shared goal-dir lock, even if the locked body fails.
      # The TypeScript runtime uses the same lock directory.
      local rc=0
      "$@" || rc=$?
      rmdir "$LOCK_DIR" 2>/dev/null || true
      return "$rc"
    fi
    sleep 0.05
    i=$((i + 1))
  done
  echo '{"followup_message":"cursor-goal: goal directory lock timeout"}'
  exit 0
}

read_repo_total() {
  if [[ -f "$GOAL_LOOP_FILE" ]]; then
    jq -r '.total_blocked_stops // 0' "$GOAL_LOOP_FILE" 2>/dev/null || echo 0
  elif [[ -f "$STATE_FILE" ]]; then
    jq -r '.total_blocked_stops // .loop_count // 0' "$STATE_FILE" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

read_agent_loop() {
  if [[ -f "$AGENT_STATE" ]]; then
    jq -r '.loop_count // 0' "$AGENT_STATE" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

write_repo_summary() {
  local total="$1"
  local blocked_agents="$2"
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -n \
    --argjson total "$total" \
    --argjson ll "$LOOP_LIMIT" \
    --argjson ba "$blocked_agents" \
    --arg now "$now" \
    '{
      mode: "minimal",
      total_blocked_stops: $total,
      loop_limit: $ll,
      phase: "VERIFY",
      blocked_agent_count: $ba,
      updated_at: $now
    }' >"$STATE_FILE"
}

increment_loops_locked() {
  local repo_total agent_loop now blocked_n
  repo_total="$(read_repo_total)"
  repo_total=$((repo_total + 1))
  agent_loop="$(read_agent_loop)"
  agent_loop=$((agent_loop + 1))
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -n \
    --argjson total "$repo_total" \
    --argjson ll "$LOOP_LIMIT" \
    --arg now "$now" \
    '{total_blocked_stops:$total,loop_limit:$ll,updated_at:$now}' >"$GOAL_LOOP_FILE"
  if [[ -f "$AGENT_STATE" ]]; then
    jq \
      --argjson lc "$agent_loop" \
      --argjson ll "$LOOP_LIMIT" \
      --arg now "$now" \
      '.mode = "minimal" | .loop_count = $lc | .loop_limit = $ll | .blocked = true | .updated_at = $now' \
      "$AGENT_STATE" >"${AGENT_STATE}.tmp" && mv "${AGENT_STATE}.tmp" "$AGENT_STATE"
  else
    jq -n \
      --argjson lc "$agent_loop" \
      --argjson ll "$LOOP_LIMIT" \
      --arg now "$now" \
      '{
        mode: "minimal",
        loop_count: $lc,
        loop_limit: $ll,
        phase: "VERIFY",
        blocked: true,
        blockers: [],
        next_action: null,
        last_check_fail: null,
        updated_at: $now
      }' >"$AGENT_STATE"
  fi
  blocked_n="$(count_submit_blocked_agents)"
  write_repo_summary "$repo_total" "$blocked_n"
  printf '%s' "$agent_loop"
}

unblock_agent_state() {
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ -f "$AGENT_STATE" ]]; then
    jq \
      --arg now "$now" \
      '.blocked = false | .blockers = [] | .next_action = null | .last_check_fail = null | .updated_at = $now' \
      "$AGENT_STATE" >"${AGENT_STATE}.tmp" && mv "${AGENT_STATE}.tmp" "$AGENT_STATE"
  fi
}

count_submit_blocked_agents() {
  local n=0 agent_dir agent_id
  if [[ ! -d "$GOAL_DIR/agents" ]]; then
    printf '%s' "0"
    return 0
  fi
  for agent_dir in "$GOAL_DIR/agents"/*; do
    [[ -d "$agent_dir" ]] || continue
    agent_id="${agent_dir##*/}"
    if [[ -f "$agent_dir/DISPOSITION.json" ]]; then
      n=$((n + 1))
      continue
    fi
    if [[ -f "$agent_dir/runtime-state.json" ]] && jq -e '.blocked == true' "$agent_dir/runtime-state.json" >/dev/null 2>&1; then
      n=$((n + 1))
    fi
  done
  printf '%s' "$n"
}

clear_all_agents_blocked() {
  local now agent_file
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ ! -d "$GOAL_DIR/agents" ]]; then
    return 0
  fi
  for agent_file in "$GOAL_DIR"/agents/*/runtime-state.json; do
    [[ -e "$agent_file" ]] || continue
    jq \
      --arg now "$now" \
      '.blocked = false | .blockers = [] | .next_action = null | .last_check_fail = null | .updated_at = $now' \
      "$agent_file" >"${agent_file}.tmp" && mv "${agent_file}.tmp" "$agent_file"
  done
}

clear_agent_disposition() {
  local disp_file
  if [[ -f "$AGENT_DIR/DISPOSITION.json" ]]; then
    rm -f "$AGENT_DIR/DISPOSITION.json" "$AGENT_DIR/DISPOSITION.md"
  fi
  if [[ -d "$GOAL_DIR/agents" ]]; then
    local agents=()
    for disp_file in "$GOAL_DIR"/agents/*/DISPOSITION.json; do
      [[ -e "$disp_file" ]] || continue
      agents+=("$(basename "$(dirname "$disp_file")")")
    done
    if [[ ${#agents[@]} -eq 0 ]]; then
      rm -f "$PASSPORTS/DISPOSITION.json" "$PASSPORTS/DISPOSITION.md"
    else
      jq -n --argjson a "$(printf '%s\n' "${agents[@]}" | jq -R . | jq -s .)" \
        '{status:"DISPOSITION",agents_in_disposition:$a,at:"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' \
        >"$PASSPORTS/DISPOSITION.json"
    fi
  fi
}

reset_all_loops() {
  local now blocked_n
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -n \
    --argjson ll "$LOOP_LIMIT" \
    --arg now "$now" \
    '{total_blocked_stops:0,loop_limit:$ll,updated_at:$now}' >"$GOAL_LOOP_FILE"
  clear_all_agents_blocked
  clear_agent_disposition
  if [[ -f "$AGENT_STATE" ]]; then
    jq \
      --arg now "$now" \
      '.loop_count = 0 | .blocked = false | .blockers = [] | .next_action = null | .last_check_fail = null | .updated_at = $now' \
      "$AGENT_STATE" >"${AGENT_STATE}.tmp" && mv "${AGENT_STATE}.tmp" "$AGENT_STATE"
  fi
  blocked_n="$(count_submit_blocked_agents)"
  write_repo_summary 0 "$blocked_n"
}

write_release_passport() {
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ -d "$PASSPORTS/RELEASE.json" ]]; then
    return 1
  fi
  RELEASE_TMP="$PASSPORTS/.RELEASE.json.tmp.$$"
  jq -n \
    --arg now "$now" \
    --arg conv "$CONV_ID" \
    --argjson cursor "$CURSOR_LOOP" \
    '{
      status: "RELEASE",
      at: $now,
      mode: "minimal",
      loop_count: 0,
      cursor_stop_index: $cursor,
      conversation_id: $conv
    }' >"$RELEASE_TMP"
}

cleanup_release_tmp() {
  if [[ -n "${RELEASE_TMP:-}" ]]; then
    rm -f "$RELEASE_TMP" 2>/dev/null || true
  fi
}

commit_release_passport() {
  rm -f "$PASSPORTS/SESSION_END.json" "$PASSPORTS/SESSION_END.md"
  mv "$RELEASE_TMP" "$PASSPORTS/RELEASE.json"
  RELEASE_TMP=""
}

release_all_locked() {
  if write_release_passport; then
    :
  else
    local rc=$?
    cleanup_release_tmp
    return "$rc"
  fi
  if reset_all_loops; then
    :
  else
    local rc=$?
    cleanup_release_tmp
    return "$rc"
  fi
  if commit_release_passport; then
    :
  else
    local rc=$?
    cleanup_release_tmp
    return "$rc"
  fi
}

if [[ ! -f GOAL.md ]]; then
  unblock_agent_state
  echo '{"followup_message":"GOAL.md is missing. Create GOAL.md from .cursor/goal/templates/GOAL.md with ## Checks shell commands."}'
  exit 0
fi

FAILURES=()
CHECK_COUNT=0
IN_CHECKS=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == "## Checks" ]]; then
    IN_CHECKS=1
    continue
  fi
  if [[ $IN_CHECKS -eq 1 ]] && [[ "$line" =~ ^##[[:space:]] ]]; then
    break
  fi
  if [[ $IN_CHECKS -eq 1 ]] && [[ "$line" =~ ^-[[:space:]]+ ]]; then
    cmd="${line#- }"
    cmd="${cmd#\`}"
    cmd="${cmd%\`}"
    cmd="$(echo "$cmd" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$cmd" ]] && continue
    CHECK_COUNT=$((CHECK_COUNT + 1))
    if ! bash -c "$cmd" </dev/null >/dev/null 2>&1; then
      FAILURES+=("$cmd")
    fi
  fi
done < GOAL.md

if [[ "$CHECK_COUNT" -eq 0 ]]; then
  unblock_agent_state
  MSG="GOAL.md ## Checks is empty. Add at least one shell command (e.g. npm test) that must exit 0 before release."
  jq -n --arg m "$MSG" '{followup_message:$m}'
  exit 0
fi

if [[ ${#FAILURES[@]} -eq 0 ]]; then
  if ! with_goal_lock release_all_locked; then
    exit 1
  fi
  echo '{}'
  exit 0
fi

GOAL_LOOP="$(with_goal_lock increment_loops_locked)"
REPO_TOTAL="$(read_repo_total)"

BUDGET="$GOAL_LOOP"
if [[ "$CURSOR_LOOP" -gt "$BUDGET" ]]; then
  BUDGET="$CURSOR_LOOP"
fi

if [[ "$BUDGET" -ge $((LOOP_LIMIT - 2)) ]]; then
  {
    echo "# Disposition"
    echo "- agent: $AGENT_ID"
    echo "- at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "- mode: minimal"
    echo "- goal_blocked_count: $GOAL_LOOP"
    echo "- cursor_stop_index: $CURSOR_LOOP"
    echo "- failed_checks:"
    for f in "${FAILURES[@]}"; do echo "  - \`$f\`"; done
  } > "$AGENT_DIR/DISPOSITION.md"
  FAILED_JSON="$(printf '%s\n' "${FAILURES[@]}" | jq -R . | jq -s .)"
  jq -n \
    --arg conv "$CONV_ID" \
    --arg agent "$AGENT_ID" \
    --argjson goal "$GOAL_LOOP" \
    --argjson cursor "$CURSOR_LOOP" \
    --argjson budget "$BUDGET" \
    --argjson failed "$FAILED_JSON" \
    '{
      status: "DISPOSITION",
      recoverable: true,
      goal_blocked_count: $goal,
      cursor_stop_index: $cursor,
      loop_count: $budget,
      conversation_id: $conv,
      agent_id: $agent,
      failed: $failed,
      failed_checks: $failed
    }' >"$AGENT_DIR/DISPOSITION.json"
  jq -n \
    --arg agent "$AGENT_ID" \
    --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{status:"DISPOSITION",agents_in_disposition:[$agent],at:$now}' >"$PASSPORTS/DISPOSITION.json"
  LOOP_LINE="$(goal_loop_line "$GOAL_LOOP" "$LOOP_LIMIT" "$CURSOR_LOOP" "$REPO_TOTAL")"
  DISP_MSG="## Disposition — loop budget exhausted

$LOOP_LINE

Human review required. See .cursor/goal/agents/$AGENT_ID/DISPOSITION.md"
  jq -n --arg m "$DISP_MSG" '{followup_message:$m}'
  exit 0
fi

REASON=$(printf '%s; ' "${FAILURES[@]}")
REASON="${REASON%; }"
LOOP_LINE="$(goal_loop_line "$GOAL_LOOP" "$LOOP_LIMIT" "$CURSOR_LOOP" "$REPO_TOTAL")"
MSG="$LOOP_LINE — checks failed: $REASON. Fix, run checks locally, update PROGRESS.md, continue toward GOAL.md."
jq -n --arg m "$MSG" '{followup_message:$m}'
