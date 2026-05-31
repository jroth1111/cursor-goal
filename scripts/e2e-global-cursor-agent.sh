#!/usr/bin/env bash
# Global cursor-goal E2E — up to 20 scenarios with traces (hook-direct + optional live agent).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GLOBAL_HOOKS="${HOME}/.cursor/hooks"
ENV_FILE="${HOME}/.cursor/cursor-goal.env"
RUNTIME="${HOME}/.cursor/cursor-goal-runtime"
CLI="${RUNTIME}/dist/cli.js"

REPO_MAIN="/tmp/test_cursor_goal"
REPO_NOGIT="/tmp/test_cursor_goal_nogit"
REPO_NOAUTO="/tmp/test_cursor_goal_noauto"
REPORT_DIR="/tmp/test_cursor_goal_report"

E2E_HOOKS_ONLY="${E2E_HOOKS_ONLY:-0}"
E2E_SKIP_AGENT="${E2E_SKIP_AGENT:-0}"
E2E_AGENT_TESTS="${E2E_AGENT_TESTS:-T17,T18}"

declare -A RESULTS
ALL_IDS=(T01 T02 T03 T04 T05 T06 T07 T08 T09 T10 T11 T12 T13 T14 T15 T16 T17 T18 T19 T20 T21 T22)

# shellcheck source=/dev/null
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"
export CURSOR_GOAL_E2E_TRACE=1
export PATH="${HOME}/.local/bin:${PATH}"
mkdir -p "$REPORT_DIR"

pass() { RESULTS["$1"]="PASS"; echo "  PASS $1"; }
fail() { RESULTS["$1"]="FAIL: $2"; echo "  FAIL $1 — $2"; }
skip() { RESULTS["$1"]="SKIP: $2"; echo "  SKIP $1 — $2"; }

agent_test_enabled() {
  local id="$1"
  [[ "$E2E_HOOKS_ONLY" == "1" ]] || [[ "$E2E_SKIP_AGENT" == "1" ]] && return 1
  [[ ",${E2E_AGENT_TESTS}," == *",${id},"* ]]
}

capture_state() {
  local id="$1" dir="$2"
  local out="$REPORT_DIR/${id}-state.txt"
  {
    echo "=== $id $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    echo "dir=$dir"
    ls -la "$dir" 2>/dev/null || true
    if [[ -f "$dir/GOAL.md" ]]; then echo "--- GOAL.md ---"; head -20 "$dir/GOAL.md" || true; fi
    if [[ -d "$dir/.cursor/goal" ]]; then find "$dir/.cursor/goal" -type f 2>/dev/null | sort || true; fi
    if [[ -f "$dir/.cursor/goal/e2e-trace.jsonl" ]]; then
      echo "--- trace ($(wc -l <"$dir/.cursor/goal/e2e-trace.jsonl" | tr -d ' ') lines) ---"
      cat "$dir/.cursor/goal/e2e-trace.jsonl" || true
    fi
  } >"$out" 2>&1 || true
}

init_git_repo() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir"
  (cd "$dir" && git init -q && git config user.email "e2e@test.local" && git config user.name "E2E" \
    && touch .gitkeep && git add -A && git commit -q -m init)
}

run_hook() {
  local dir="$1" step="$2" stdin="${3-}"
  [[ -z "$stdin" ]] && stdin='{}'
  local script
  case "$step" in
    sessionStart) script="$GLOBAL_HOOKS/goal-session-start.sh" ;;
    beforeSubmitPrompt) script="$GLOBAL_HOOKS/goal-prompt.sh" ;;
    preToolUse) script="$GLOBAL_HOOKS/goal-pre-tool.sh" ;;
    beforeShellExecution) script="$GLOBAL_HOOKS/goal-shell.sh" ;;
    postToolUse) script="$GLOBAL_HOOKS/goal-post-tool.sh" ;;
    stop) script="$GLOBAL_HOOKS/goal-stop.sh" ;;
    subagentStop) script="$GLOBAL_HOOKS/goal-subagent-stop.sh" ;;
    sessionEnd) script="$GLOBAL_HOOKS/goal-session-end.sh" ;;
    *) echo "unknown step: $step" >&2; return 1 ;;
  esac
  rm -f "$dir/.cursor/goal/e2e-trace.jsonl" 2>/dev/null || true
  env CURSOR_PROJECT_DIR="$dir" CURSOR_GOAL_E2E_TRACE=1 bash "$script" <<<"$stdin"
}

run_hook_append() {
  local dir="$1" step="$2" stdin="${3-}"
  [[ -z "$stdin" ]] && stdin='{}'
  local script
  case "$step" in
    sessionStart) script="$GLOBAL_HOOKS/goal-session-start.sh" ;;
    beforeSubmitPrompt) script="$GLOBAL_HOOKS/goal-prompt.sh" ;;
    preToolUse) script="$GLOBAL_HOOKS/goal-pre-tool.sh" ;;
    beforeShellExecution) script="$GLOBAL_HOOKS/goal-shell.sh" ;;
    stop) script="$GLOBAL_HOOKS/goal-stop.sh" ;;
    sessionEnd) script="$GLOBAL_HOOKS/goal-session-end.sh" ;;
    *) echo "unknown step: $step" >&2; return 1 ;;
  esac
  env CURSOR_PROJECT_DIR="$dir" CURSOR_GOAL_E2E_TRACE=1 bash "$script" <<<"$stdin"
}

# Hook with isolated HOME (no global runtime) for I38-style tests
run_hook_no_runtime() {
  local dir="$1" step="$2" stdin="${3-}"
  [[ -z "$stdin" ]] && stdin='{}'
  local isolated
  isolated="$(mktemp -d /tmp/cgr-isolated-home-XXXXXX)"
  local script="$GLOBAL_HOOKS/goal-pre-tool.sh"
  [[ "$step" == "beforeSubmitPrompt" ]] && script="$GLOBAL_HOOKS/goal-prompt.sh"
  env -u CURSOR_GOAL_RUNTIME -u CURSOR_GOAL_ALLOW_MINIMAL \
    HOME="$isolated" CURSOR_PROJECT_DIR="$dir" CURSOR_GOAL_E2E_TRACE=1 \
    bash "$script" <<<"$stdin"
  rm -rf "$isolated"
}

trace_has_step() {
  local dir="$1" step="$2"
  [[ -f "$dir/.cursor/goal/e2e-trace.jsonl" ]] && \
    grep -q "\"step\":\"$step\"" "$dir/.cursor/goal/e2e-trace.jsonl" 2>/dev/null
}

trace_all_valid_json() {
  local dir="$1"
  [[ -f "$dir/.cursor/goal/e2e-trace.jsonl" ]] || return 1
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    echo "$line" | jq -e '.ts and .step and .runtime' >/dev/null 2>&1 || return 1
  done <"$dir/.cursor/goal/e2e-trace.jsonl"
}

run_agent() {
  local id="$1" workspace="$2" prompt="$3"
  local log="$REPORT_DIR/${id}.log"
  shift 3
  local extra=("$@")
  if ! agent_test_enabled "$id"; then
    skip "$id" "agent disabled (E2E_HOOKS_ONLY or not in E2E_AGENT_TESTS)"
    return 0
  fi
  if ! command -v cursor-agent-goal >/dev/null 2>&1; then
    skip "$id" "cursor-agent-goal not on PATH"
    return 0
  fi
  echo "  Running cursor-agent-goal ($id)..."
  set +e
  env "${extra[@]}" CURSOR_PROJECT_DIR="$workspace" CURSOR_GOAL_E2E_TRACE=1 \
    cursor-agent-goal --print --trust --force --workspace "$workspace" --output-format text \
    "$prompt" >"$log" 2>&1
  local ec=$?
  set -e
  echo "  agent exit=$ec"
}

seed_goal_checks() {
  local dir="$1" checks="${2:-true}"
  cat >"$dir/GOAL.md" <<EOF
## Goal
E2E test goal

## Checks
- \`${checks}\`
EOF
  env CURSOR_PROJECT_DIR="$dir" node "$CLI" compile >/dev/null
}

# --- T01–T03 Preflight ---
run_t01_t03() {
  echo "=== T01–T03 Preflight ==="
  init_git_repo "$REPO_MAIN"
  if node "$CLI" doctor >"$REPORT_DIR/T01.log" 2>&1 && ! grep -q "^error:" "$REPORT_DIR/T01.log"; then
    pass T01
  else
    fail T01 "$(head -3 "$REPORT_DIR/T01.log")"
  fi

  if jq -e '.hooks.stop[]? | select(.command | contains("goal-stop"))' "${HOME}/.cursor/hooks.json" >/dev/null && \
     ! jq -e '.hooks.hooks' "${HOME}/.cursor/hooks.json" >/dev/null 2>&1; then
    pass T02
  else
    fail T02 "hooks.json missing goal-stop or nested hooks.hooks"
  fi

  rm -rf /tmp/cursor_home_e2e
  if CURSOR_HOME=/tmp/cursor_home_e2e bash "$SCRIPT_DIR/install-global.sh" --skip-build --dry-run \
    >"$REPORT_DIR/T03.log" 2>&1 && \
    [[ -f /tmp/cursor_home_e2e/cursor-goal/install-manifest.json ]]; then
    pass T03
  else
    fail T03 "install-global dry-run failed"
  fi
}

# --- T04–T16 Hook-direct edge cases ---
run_hook_edge_cases() {
  echo "=== T04–T16 Hook-direct edge cases ==="
  local out

  # T04: no trajectory → DISCOVERY default → Write denied
  init_git_repo "$REPO_MAIN"
  out="$(run_hook "$REPO_MAIN" preToolUse '{"tool_name":"Write","tool_input":{"path":"x.txt"}}')"
  if echo "$out" | jq -e '.permission == "deny"' >/dev/null; then pass T04; else fail T04 "got: $out"; fi
  capture_state T04 "$REPO_MAIN"

  # T05: stale GOAL auto-recompile on beforeSubmitPrompt
  init_git_repo "$REPO_MAIN"
  seed_goal_checks "$REPO_MAIN" "true"
  run_hook "$REPO_MAIN" sessionStart '{}' >/dev/null
  local before after
  before="$(jq -r '.compiled_at' "$REPO_MAIN/.cursor/goal/manifest.json")"
  echo "stale" >>"$REPO_MAIN/GOAL.md"
  sleep 1
  out="$(run_hook "$REPO_MAIN" beforeSubmitPrompt '{}')"
  after="$(jq -r '.compiled_at' "$REPO_MAIN/.cursor/goal/manifest.json")"
  if echo "$out" | jq -e '.continue == true' >/dev/null && [[ "$before" != "$after" ]]; then
    pass T05
  else
    fail T05 "no recompile: before=$before after=$after out=$out"
  fi

  # T06: global runtime resolution
  rt="$(env CURSOR_PROJECT_DIR="$REPO_MAIN" bash -c "source '$GLOBAL_HOOKS/_cgr-lib.sh' && cgr_resolve_runtime")"
  if [[ "$rt" == "$RUNTIME" ]]; then pass T06; else fail T06 "got: $rt"; fi

  # T07: sessionStart auto-init in git repo (governed default only)
  init_git_repo "$REPO_MAIN"
  mkdir -p "$REPO_MAIN/.cursor/goal"
  echo '{"default_mode":"governed"}' >"$REPO_MAIN/.cursor/goal/config.json"
  run_hook "$REPO_MAIN" sessionStart '{}' >/dev/null
  if [[ -f "$REPO_MAIN/GOAL.md" ]] && [[ -f "$REPO_MAIN/.cursor/goal/manifest.json" ]]; then
    pass T07
  else
    fail T07 "missing GOAL.md or manifest"
  fi
  capture_state T07 "$REPO_MAIN"

  # T08: beforeSubmitPrompt blocks without GOAL in governed mode
  init_git_repo "$REPO_NOAUTO"
  mkdir -p "$REPO_NOAUTO/.cursor/goal"
  echo '{"default_mode":"governed"}' >"$REPO_NOAUTO/.cursor/goal/config.json"
  out="$(env CURSOR_PROJECT_DIR="$REPO_NOAUTO" CURSOR_GOAL_NO_AUTO_INIT=1 \
    bash "$GLOBAL_HOOKS/goal-prompt.sh" <<<"{}")"
  if echo "$out" | jq -e '.continue == false' >/dev/null; then pass T08; else fail T08 "got: $out"; fi

  # T09: PAUSED blocks beforeSubmitPrompt
  init_git_repo "$REPO_MAIN"
  run_hook "$REPO_MAIN" sessionStart '{}' >/dev/null
  touch "$REPO_MAIN/.cursor/goal/PAUSED"
  out="$(run_hook_append "$REPO_MAIN" beforeSubmitPrompt '{}')"
  if echo "$out" | jq -e '.continue == false' >/dev/null && \
     echo "$out" | grep -qi paused; then
    pass T09
  else
    fail T09 "got: $out"
  fi

  # T10: stop returns followup on failing checks
  init_git_repo "$REPO_MAIN"
  seed_goal_checks "$REPO_MAIN" "false"
  echo '{"phase":"VERIFY"}' >"$REPO_MAIN/.cursor/goal/trajectory.json"
  echo '{"completed":true}' >"$REPO_MAIN/.cursor/goal/discovery.json"
  out="$(run_hook "$REPO_MAIN" stop '{"status":"completed","loop_count":0}')"
  if echo "$out" | jq -e '.followup_message | length > 10' >/dev/null 2>&1; then
    pass T10
  else
    fail T10 "expected followup_message, got: $out"
  fi
  capture_state T10 "$REPO_MAIN"

  # T11: DISCOVERY phase Edit denied
  init_git_repo "$REPO_MAIN"
  run_hook "$REPO_MAIN" sessionStart '{}' >/dev/null
  echo '{"phase":"DISCOVERY"}' >"$REPO_MAIN/.cursor/goal/trajectory.json"
  out="$(run_hook_append "$REPO_MAIN" preToolUse '{"tool_name":"Edit","tool_input":{"path":"src/a.ts"}}')"
  if echo "$out" | jq -e '.permission == "deny"' >/dev/null && \
     echo "$out" | grep -qi discovery; then
    pass T11
  else
    fail T11 "got: $out"
  fi

  # T12: global schemas path used by compile
  init_git_repo "$REPO_MAIN"
  cat >"$REPO_MAIN/GOAL.md" <<'EOF'
## Goal
Schema test

## Work units
### mod-a
A
- `pkg/a/`

## Checks
- `true`
EOF
  if [[ -d "${HOME}/.cursor/goal/schemas" ]] && \
     env CURSOR_PROJECT_DIR="$REPO_MAIN" CURSOR_GOAL_SCHEMAS="${HOME}/.cursor/goal/schemas" \
       node "$CLI" compile >"$REPORT_DIR/T12.log" 2>&1 && \
     [[ -f "$REPO_MAIN/.cursor/goal/manifest.json" ]]; then
    pass T12
  else
    fail T12 "compile with global schemas failed: $(head -2 "$REPORT_DIR/T12.log")"
  fi

  # T13: compile emits dispatch-queue.json
  if [[ -f "$REPO_MAIN/.cursor/goal/dispatch-queue.json" ]] && \
     jq -e '.items and (.head_index | type == "number")' "$REPO_MAIN/.cursor/goal/dispatch-queue.json" >/dev/null 2>&1; then
    pass T13
  else
    fail T13 "dispatch-queue.json missing or invalid (expected items + head_index)"
  fi

  # T14: Write outside scope denied (IMPLEMENT + enforced scope)
  cat >"$REPO_MAIN/GOAL.md" <<'EOF'
## Goal
Scope gate test

## Scope
- `src/`

## Checks
- `true`
EOF
  env CURSOR_PROJECT_DIR="$REPO_MAIN" node "$CLI" compile >/dev/null
  echo '{"phase":"IMPLEMENT"}' >"$REPO_MAIN/.cursor/goal/trajectory.json"
  echo '{"completed":true}' >"$REPO_MAIN/.cursor/goal/discovery.json"
  out="$(run_hook_append "$REPO_MAIN" preToolUse \
    '{"tool_name":"Write","tool_input":{"path":"outside/forbidden.txt"}}')"
  if echo "$out" | jq -e '.permission == "deny"' >/dev/null && \
     echo "$out" | grep -qi 'scope\|WriteGate\|outside'; then
    pass T14
  else
    fail T14 "expected out-of-scope deny, got: $out"
  fi

  # T15: I38 — no runtime uses minimal fallback and allows governed writes
  init_git_repo "$REPO_MAIN"
  mkdir -p "$REPO_MAIN/src"
  out="$(run_hook_no_runtime "$REPO_MAIN" preToolUse '{"tool_name":"Write","file_path":"src/no-runtime.ts"}')"
  if echo "$out" | jq -e '.permission == "allow"' >/dev/null && \
     echo "$out" | grep -qi 'runtime not built'; then
    pass T15
  else
    fail T15 "expected runtime minimal allow, got: $out"
  fi

  # T16: install skip local hooks + double install-global stays flat
  init_git_repo "$REPO_MAIN"
  bash "$REPO_ROOT/core/install.sh" "$REPO_MAIN" >"$REPORT_DIR/T16.log" 2>&1
  local t16_ok=0
  [[ ! -f "$REPO_MAIN/.cursor/hooks/goal-stop.sh" ]] && \
    [[ -f "$REPO_MAIN/.cursor/goal/templates/GOAL.md" ]] && t16_ok=1
  bash "$SCRIPT_DIR/install-global.sh" --skip-build >>"$REPORT_DIR/T16.log" 2>&1
  if [[ "$t16_ok" -eq 1 ]] && ! jq -e '.hooks.hooks' "${HOME}/.cursor/hooks.json" >/dev/null 2>&1; then
    pass T16
  else
    fail T16 "install skip or hooks.json nested after reinstall"
  fi

  # T17: live agent auto-init in git repo (or skip)
  if agent_test_enabled T17; then
    init_git_repo "$REPO_MAIN"
    run_agent T17 "$REPO_MAIN" \
      "E2E T17. Do ONLY list directory contents. Do not create or edit files."
    capture_state T17 "$REPO_MAIN"
    if [[ -f "$REPO_MAIN/GOAL.md" ]]; then pass T17; else fail T17 "GOAL.md missing after agent"; fi
  else
    skip T17 "agent disabled (unset E2E_HOOKS_ONLY or use npm run goal:e2e:global)"
  fi
}

run_extra_edge_cases() {
  echo "=== T18–T19 Additional edge cases ==="
  local out

  # T18: non-git — no auto-init (hook); optional agent must not create GOAL
  rm -rf "$REPO_NOGIT"
  mkdir -p "$REPO_NOGIT"
  out="$(env CURSOR_PROJECT_DIR="$REPO_NOGIT" CURSOR_GOAL_E2E_TRACE=1 \
    bash "$GLOBAL_HOOKS/goal-session-start.sh" <<<"{}")"
  local t18_ok=0
  [[ ! -f "$REPO_NOGIT/GOAL.md" ]] && t18_ok=1
  if agent_test_enabled T18; then
    run_agent T18 "$REPO_NOGIT" \
      "E2E T18 non-git. Reply OK only. Do not create or edit any files."
    capture_state T18-agent "$REPO_NOGIT"
    [[ ! -f "$REPO_NOGIT/GOAL.md" ]] && t18_ok=1 || t18_ok=0
  fi
  if [[ "$t18_ok" -eq 1 ]]; then pass T18; else fail T18 "GOAL.md in non-git dir"; fi
  capture_state T18 "$REPO_NOGIT"

  # T19: empty ## Checks — stop must not RELEASE
  init_git_repo "$REPO_MAIN"
  cat >"$REPO_MAIN/GOAL.md" <<'EOF'
## Goal
Empty checks edge case

## Checks

EOF
  env CURSOR_PROJECT_DIR="$REPO_MAIN" node "$CLI" compile >/dev/null 2>&1 || true
  echo '{"phase":"VERIFY"}' >"$REPO_MAIN/.cursor/goal/trajectory.json"
  echo '{"completed":true}' >"$REPO_MAIN/.cursor/goal/discovery.json"
  out="$(run_hook "$REPO_MAIN" stop '{"status":"completed","loop_count":0}')"
  if [[ ! -f "$REPO_MAIN/.cursor/goal/passports/RELEASE.json" ]] && \
     { echo "$out" | jq -e '.followup_message' >/dev/null 2>&1 || \
       echo "$out" | jq -e 'length == 0' >/dev/null 2>&1; }; then
    pass T19
  else
    fail T19 "empty checks must not RELEASE; got: $out"
  fi
  capture_state T19 "$REPO_MAIN"
}

# --- T21 Stuck loop_count (hook-direct) ---
run_t21_stuck_loop() {
  echo "=== T21 Stuck loop_count hook-direct ==="
  init_git_repo "$REPO_MAIN"
  seed_goal_checks "$REPO_MAIN" "false"
  echo '{"phase":"VERIFY"}' >"$REPO_MAIN/.cursor/goal/trajectory.json"
  echo '{"completed":true}' >"$REPO_MAIN/.cursor/goal/discovery.json"

  local n out msg lc
  for n in 1 2 3; do
    out="$(run_hook_append "$REPO_MAIN" stop '{"status":"completed","loop_count":25}')"
    msg="$(echo "$out" | jq -r '.followup_message // empty')"
    if ! echo "$msg" | grep -q "GOAL loop ${n}/40"; then
      fail T21 "stop $n: expected GOAL loop ${n}/40 in: $msg"
      capture_state T21 "$REPO_MAIN"
      return
    fi
    lc="$(jq -r '.loop_count // -1' "$REPO_MAIN/.cursor/goal/runtime-state.json" 2>/dev/null || echo -1)"
    if [[ "$lc" != "$n" ]]; then
      fail T21 "stop $n: runtime-state loop_count=$lc expected $n"
      capture_state T21 "$REPO_MAIN"
      return
    fi
  done

  if trace_has_step "$REPO_MAIN" stop && \
     grep -q 'GOAL loop 1/40' "$REPO_MAIN/.cursor/goal/e2e-trace.jsonl" 2>/dev/null; then
    pass T21
  else
    fail T21 "e2e trace missing GOAL loop progress"
  fi
  capture_state T21 "$REPO_MAIN"
}

# --- T22 Live agent stop hooks (optional) ---
run_t22_live_agent_loop() {
  echo "=== T22 Live cursor-agent-goal (optional) ==="
  if ! agent_test_enabled T22; then
    skip T22 "agent disabled (E2E_HOOKS_ONLY or not in E2E_AGENT_TESTS)"
    return
  fi

  init_git_repo "$REPO_MAIN"
  seed_goal_checks "$REPO_MAIN" "false"
  echo '{"phase":"VERIFY"}' >"$REPO_MAIN/.cursor/goal/trajectory.json"
  echo '{"completed":true}' >"$REPO_MAIN/.cursor/goal/discovery.json"
  env CURSOR_PROJECT_DIR="$REPO_MAIN" node "$CLI" mode governed >/dev/null 2>&1 || true

  run_agent T22 "$REPO_MAIN" \
    "E2E T22: Make one small edit in GOAL.md (do not fix the failing check). Run checks. Stop when blocked."

  capture_state T22 "$REPO_MAIN"

  local score=0
  local trace="$REPO_MAIN/.cursor/goal/e2e-trace.jsonl"
  local stops=0
  if [[ -f "$trace" ]]; then
    stops="$(grep -c '"step":"stop"' "$trace" 2>/dev/null || echo 0)"
    grep -q 'GOAL loop' "$trace" 2>/dev/null && score=$((score + 1))
  fi
  [[ "$stops" -ge 2 ]] && score=$((score + 1))
  if [[ -f "$REPO_MAIN/.cursor/goal/runtime-state.json" ]] && \
     [[ ! -f "$REPO_MAIN/.cursor/goal/passports/RELEASE.json" ]]; then
    local rs
    rs="$(jq -r '.loop_count // 0' "$REPO_MAIN/.cursor/goal/runtime-state.json" 2>/dev/null || echo 0)"
    [[ "$rs" -ge 1 ]] && score=$((score + 1))
  fi
  if [[ -f "$REPORT_DIR/T22.log" ]] && grep -q 'GOAL loop' "$REPORT_DIR/T22.log" 2>/dev/null; then
    score=$((score + 1))
  fi

  if [[ "$score" -ge 2 ]]; then
    pass T22
  else
    fail T22 "need 2/4 signals (trace stops=$stops score=$score)"
  fi
}

# --- T20 Trace + shell gate ---
run_t20_trace() {
  echo "=== T20 Trace + shell gate ==="
  init_git_repo "$REPO_MAIN"
  run_hook "$REPO_MAIN" sessionStart '{}' >/dev/null
  run_hook_append "$REPO_MAIN" preToolUse '{"tool_name":"Read","tool_input":{"path":"GOAL.md"}}' >/dev/null || true
  local out
  out="$(run_hook_append "$REPO_MAIN" beforeShellExecution '{"command":"rm -rf /"}')"
  local shell_deny=0
  echo "$out" | jq -e '.permission == "deny"' >/dev/null 2>&1 && shell_deny=1
  run_hook_append "$REPO_MAIN" sessionEnd '{}' >/dev/null
  capture_state T20 "$REPO_MAIN"
  if trace_all_valid_json "$REPO_MAIN" && \
     trace_has_step "$REPO_MAIN" sessionStart && \
     trace_has_step "$REPO_MAIN" sessionEnd && \
     [[ "$shell_deny" -eq 1 ]]; then
    pass T20
  else
    fail T20 "trace invalid or beforeShellExecution did not deny rm -rf"
  fi
}

write_summary() {
  local summary="$REPORT_DIR/SUMMARY.md"
  local fails=0
  for r in "${RESULTS[@]}"; do [[ "$r" == FAIL* ]] && fails=$((fails + 1)); done
  {
    echo "# cursor-goal E2E report (22 tests)"
    echo ""
    echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
    echo "## Verdict: $([[ $fails -eq 0 ]] && echo '**PASS**' || echo "**$fails FAILURE(S)**")"
    echo ""
    echo "| ID | Result | Description |"
    echo "|----|--------|-------------|"
    echo "| T01 | ${RESULTS[T01]:-SKIP} | doctor OK |"
    echo "| T02 | ${RESULTS[T02]:-SKIP} | flat hooks.json |"
    echo "| T03 | ${RESULTS[T03]:-SKIP} | install-global dry-run |"
    echo "| T04 | ${RESULTS[T04]:-SKIP} | Write denied (DISCOVERY default) |"
    echo "| T05 | ${RESULTS[T05]:-SKIP} | stale GOAL auto-recompile |"
    echo "| T06 | ${RESULTS[T06]:-SKIP} | global runtime resolve |"
    echo "| T07 | ${RESULTS[T07]:-SKIP} | sessionStart auto-init |"
    echo "| T08 | ${RESULTS[T08]:-SKIP} | no GOAL blocks prompt (NO_AUTO_INIT) |"
    echo "| T09 | ${RESULTS[T09]:-SKIP} | PAUSED blocks prompt |"
    echo "| T10 | ${RESULTS[T10]:-SKIP} | stop followup on failing checks |"
    echo "| T11 | ${RESULTS[T11]:-SKIP} | DISCOVERY Edit denied |"
    echo "| T12 | ${RESULTS[T12]:-SKIP} | compile with global schemas |"
    echo "| T13 | ${RESULTS[T13]:-SKIP} | dispatch-queue.json emitted |"
    echo "| T14 | ${RESULTS[T14]:-SKIP} | Write outside scope denied |"
    echo "| T15 | ${RESULTS[T15]:-SKIP} | I38: no runtime → deny |"
    echo "| T16 | ${RESULTS[T16]:-SKIP} | install skip + flat hooks.json on reinstall |"
    echo "| T17 | ${RESULTS[T17]:-SKIP} | agent auto-init in git repo |"
    echo "| T18 | ${RESULTS[T18]:-SKIP} | non-git: no GOAL (hook ± agent) |"
    echo "| T19 | ${RESULTS[T19]:-SKIP} | empty checks: no RELEASE |"
    echo "| T20 | ${RESULTS[T20]:-SKIP} | trace JSON + shell deny |"
    echo "| T21 | ${RESULTS[T21]:-SKIP} | stuck loop_count:25 → GOAL loop 1..3 |"
    echo "| T22 | ${RESULTS[T22]:-SKIP} | live agent stop hooks (optional) |"
    echo ""
    echo "## Artifacts"
    echo "- \`$REPORT_DIR/\` — logs, \`*-state.txt\` with full traces"
    echo "- \`$REPO_MAIN\` — primary test repo"
    echo ""
    echo "## Re-run"
    echo '```bash'
    echo "E2E_HOOKS_ONLY=1 npm run goal:e2e:global   # T01–T21, T20 (fast; no T22 agent)"
    echo "E2E_AGENT_TESTS=T17,T18,T22 npm run goal:e2e:global  # incl. live agent"
    echo '```'
  } >"$summary"
  echo ""
  cat "$summary"
}

# --- Main ---
echo "cursor-goal E2E (22 tests)"
echo "  E2E_HOOKS_ONLY=$E2E_HOOKS_ONLY  E2E_AGENT_TESTS=$E2E_AGENT_TESTS"
echo ""

run_t01_t03
run_hook_edge_cases
run_extra_edge_cases
run_t21_stuck_loop
run_t20_trace
run_t22_live_agent_loop
write_summary

for r in "${RESULTS[@]}"; do
  [[ "$r" == FAIL* ]] && exit 1
done
exit 0
