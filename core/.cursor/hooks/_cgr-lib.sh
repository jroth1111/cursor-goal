# cursor-goal core — runtime resolution (optional package / supervisor safe)
# shellcheck shell=bash
set -euo pipefail

_cgr_hook_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

_cgr_project_root() {
  if [[ -n "${CURSOR_PROJECT_DIR:-}" ]]; then
    printf '%s\n' "$CURSOR_PROJECT_DIR"
    return
  fi
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

# Prints absolute path to cursor-goal-runtime package root, or empty.
cgr_resolve_runtime() {
  local root
  root="$(_cgr_project_root)"

  if [[ -n "${CURSOR_GOAL_RUNTIME:-}" ]]; then
    if [[ -f "$CURSOR_GOAL_RUNTIME/dist/hook-stop.mjs" ]]; then
      printf '%s\n' "$CURSOR_GOAL_RUNTIME"
      return
    fi
  fi

  local candidates=(
    "${HOME}/.cursor/cursor-goal-runtime"
    "$root/packages/cursor-goal-runtime"
    "$root/node_modules/@cursor-goal/runtime"
  )
  local p
  for p in "${candidates[@]}"; do
    if [[ -f "$p/dist/hook-stop.mjs" ]]; then
      printf '%s\n' "$p"
      return
    fi
  done
  printf '\n'
}

cgr_no_runtime_message() {
  printf '%s' "cursor-goal runtime not built. Using fail-open/minimal safety fallback. Run: npm run build"
}

cgr_no_runtime_response() {
  local step="$1"
  local msg
  msg="$(cgr_no_runtime_message)"
  # Fail open without depending on jq: the no-runtime safety path must never
  # become a hard error just because jq is unavailable. The message is a fixed
  # string with no JSON-special chars, so direct interpolation is safe.
  case "$step" in
    preToolUse|beforeShellExecution)
      printf '{"permission":"allow","agent_message":"%s"}\n' "$msg"
      ;;
    beforeSubmitPrompt|sessionStart)
      printf '{"continue":true,"agent_message":"%s"}\n' "$msg"
      ;;
    stop)
      printf '{}\n'
      ;;
    *)
      printf '{"agent_message":"%s"}\n' "$msg"
      ;;
  esac
}

cgr_e2e_trace() {
  local step="$1"
  local runtime="$2"
  local hint="${3:-}"
  if [[ "${CURSOR_GOAL_E2E_TRACE:-}" != "1" ]]; then
    return 0
  fi
  local root="${CURSOR_PROJECT_DIR:-}"
  if [[ -z "$root" ]]; then
    root="$(_cgr_project_root)"
  fi
  local trace_file="$root/.cursor/goal/e2e-trace.jsonl"
  mkdir -p "$(dirname "$trace_file")"
  local hint_trunc="${hint:0:500}"
  if ! command -v jq >/dev/null 2>&1; then
    return 0
  fi
  jq -nc \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg step "$step" \
    --arg runtime "$runtime" \
    --arg hint "$hint_trunc" \
    '{ts:$ts,step:$step,runtime:$runtime,exit_hint:$hint}' \
    >>"$trace_file"
}

cgr_attach_agent_message() {
  local out="$1"
  local msg="$2"
  if [[ -z "$msg" ]]; then
    printf '%s\n' "$out"
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    local patched
    patched="$(printf '%s' "$out" | jq --arg m "$msg" '.agent_message = (if (.agent_message? // "") == "" then $m else ((.agent_message | tostring) + "; " + $m) end)' 2>/dev/null || true)"
    if [[ -n "$patched" ]]; then
      printf '%s\n' "$patched"
      return 0
    fi
  fi
  printf '%s\n' "$out"
}

cgr_json_string_field() {
  local input="$1"
  local field="$2"
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$input" | node -e '
const fs = require("node:fs");
const field = process.argv[1];
try {
  const raw = fs.readFileSync(0, "utf8");
  const data = raw ? JSON.parse(raw) : {};
  const value = data?.[field] ?? data?.tool_input?.[field] ?? "";
  process.stdout.write(typeof value === "string" ? value : "");
} catch {}
' "$field" 2>/dev/null || true
    return 0
  fi
  printf '%s' "$input" | sed -nE "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\\1/p" | head -1
}

cgr_safety_response() {
  local step="$1"
  local input="$2"
  local tool cmd
  tool="$(cgr_json_string_field "$input" "tool_name")"
  cmd="$(cgr_json_string_field "$input" "command")"
  if [[ "$step" == "beforeShellExecution" || "$tool" == "Shell" || "$tool" == "Bash" ]]; then
    if printf '%s' "$cmd" | grep -qiE '\brm[[:space:]]+-rf\b|\bgit[[:space:]]+push[[:space:]]+--force\b|\bdrop[[:space:]]+database\b'; then
      printf '{"permission":"deny","agent_message":"Destructive shell blocked by cursor-goal minimal policy."}\n'
      return 0
    fi
  fi
  return 1
}

cgr_minimal_response() {
  local step="$1"
  local input="$2"
  local note="${3:-}"
  local lib out rc err_file err
  lib="$(_cgr_hook_dir)"
  err_file="$(mktemp "${TMPDIR:-/tmp}/cgr-minimal.XXXXXX")"

  set +e
  case "$step" in
    stop) out="$(printf '%s' "$input" | bash "$lib/verify-minimal.sh" stop 2>"$err_file")" ;;
    sessionStart) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" sessionStart 2>"$err_file")" ;;
    beforeSubmitPrompt) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" beforeSubmitPrompt 2>"$err_file")" ;;
    preToolUse) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" preToolUse 2>"$err_file")" ;;
    beforeShellExecution) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" beforeShellExecution 2>"$err_file")" ;;
    postToolUse) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" postToolUse 2>"$err_file")" ;;
    subagentStop) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" subagentStop 2>"$err_file")" ;;
    sessionEnd) out="$(printf '%s' "$input" | bash "$lib/handlers-minimal.sh" sessionEnd 2>"$err_file")" ;;
    *) out='{}' ;;
  esac
  rc=$?
  err="$(cat "$err_file" 2>/dev/null)"
  rm -f "$err_file"
  set -e

  if [[ "$rc" -ne 0 || -z "$out" ]]; then
    local safety
    safety="$(cgr_safety_response "$step" "$input" || true)"
    if [[ -n "$safety" ]]; then
      cgr_attach_agent_message "$safety" "$note"
      return 0
    fi
    if [[ -n "$err" && -z "$note" ]]; then
      note="minimal fallback failed for $step: ${err:0:300}"
    fi
    out="$(cgr_no_runtime_response "$step")"
  fi
  cgr_attach_agent_message "$out" "$note"
}

cgr_dispatch() {
  local step="$1"
  local rt out rc input note err_file err
  local trace_on=0
  [[ "${CURSOR_GOAL_E2E_TRACE:-}" == "1" ]] && trace_on=1
  input="$(cat)"

  rt="$(cgr_resolve_runtime)"
  if [[ -n "$rt" ]]; then
    err_file="$(mktemp "${TMPDIR:-/tmp}/cgr-node.XXXXXX")"
    set +e
    out="$(printf '%s' "$input" | node "$rt/dist/hook-$step.mjs" 2>"$err_file")"
    rc=$?
    err="$(cat "$err_file" 2>/dev/null)"
    rm -f "$err_file"
    set -e
    if [[ "$rc" -eq 0 ]]; then
      if [[ "$trace_on" -eq 1 ]]; then
        cgr_e2e_trace "$step" "node" "$out"
      fi
      printf '%s\n' "$out"
      exit 0
    fi

    note="cursor-goal runtime hook failed for $step; using fail-open/minimal safety fallback: ${err:-$out}"
    out="$(cgr_minimal_response "$step" "$input" "${note:0:500}")"
    if [[ "$trace_on" -eq 1 ]]; then
      cgr_e2e_trace "$step" "minimal-after-node-failure" "$out"
    fi
    printf '%s\n' "$out"
    exit 0
  fi

  note="$(cgr_no_runtime_message)"
  out="$(cgr_minimal_response "$step" "$input" "$note")"
  if [[ "$trace_on" -eq 1 ]]; then
    cgr_e2e_trace "$step" "minimal-no-runtime" "$out"
  fi
  printf '%s\n' "$out"
  exit 0
}
