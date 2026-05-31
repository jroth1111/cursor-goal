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

cgr_strict_enabled() {
  case "${CURSOR_GOAL_STRICT:-}" in
    1|true|yes|TRUE|YES) return 0 ;;
    *) return 1 ;;
  esac
}

cgr_apply_strict_before_submit() {
  local step="$1"
  local out="$2"
  if [[ "$step" != "beforeSubmitPrompt" ]] || ! cgr_strict_enabled; then
    printf '%s\n' "$out"
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    local patched
    patched="$(printf '%s' "$out" | jq '.continue = false | .agent_message = ((.agent_message // "") + "; CURSOR_GOAL_STRICT=1: runtime missing — run npm run build")' 2>/dev/null || true)"
    if [[ -n "$patched" ]]; then
      printf '%s\n' "$patched"
      return 0
    fi
  fi
  printf '{"continue":false,"agent_message":"CURSOR_GOAL_STRICT=1: cursor-goal runtime not built. Run: npm run build"}\n'
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
    beforeSubmitPrompt)
      if cgr_strict_enabled; then
        printf '{"continue":false,"agent_message":"CURSOR_GOAL_STRICT=1: %s"}\n' "$msg"
      else
        printf '{"continue":true,"agent_message":"%s"}\n' "$msg"
      fi
      ;;
    sessionStart)
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

cgr_json_bool_field() {
  local input="$1"
  local field="$2"
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$input" | node -e '
const fs = require("node:fs");
const field = process.argv[1];
try {
  const raw = fs.readFileSync(0, "utf8");
  const data = raw ? JSON.parse(raw) : {};
  const value = data?.[field] ?? data?.tool_input?.[field] ?? false;
  process.stdout.write(value === true || value === "true" ? "true" : "false");
} catch {
  process.stdout.write("false");
}
' "$field" 2>/dev/null || true
    return 0
  fi
  if printf '%s' "$input" | grep -qE "\"$field\"[[:space:]]*:[[:space:]]*true"; then
    printf 'true'
  else
    printf 'false'
  fi
}

cgr_normalize_path() {
  local raw="$1"
  if command -v node >/dev/null 2>&1; then
    node -e '
const path = require("node:path");
const raw = process.argv[1] || "";
process.stdout.write(path.posix.normalize(raw.replace(/\\/g, "/")));
' "$raw" 2>/dev/null || printf '%s' "${raw//\\//}"
    return 0
  fi
  printf '%s' "${raw//\\//}"
}

cgr_path_inside_project() {
  local file="$1"
  local root norm root_norm
  root="$(_cgr_project_root)"
  norm="$(cgr_normalize_path "$file")"
  root_norm="$(cgr_normalize_path "$root")"
  if [[ "$norm" == /* ]]; then
    [[ "$norm" == "$root_norm" || "$norm" == "$root_norm/"* ]]
    return
  fi
  [[ "$norm" != ".." && "$norm" != ../* ]]
}

cgr_destructive_shell() {
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

cgr_subagent_governance_safety() {
  local input="$1"
  local is_sub file wuid norm
  is_sub="$(cgr_json_bool_field "$input" "is_subagent")"
  [[ "$is_sub" == "true" ]] || return 1

  file="$(cgr_json_string_field "$input" "file_path")"
  if [[ -z "$file" ]]; then
    file="$(cgr_json_string_field "$input" "path")"
  fi
  [[ -n "$file" ]] || return 1

  norm="${file//\\//}"
  if [[ "$norm" != ".cursor/goal" && "$norm" != .cursor/goal/* && "$norm" != */.cursor/goal && "$norm" != */.cursor/goal/* ]]; then
    return 1
  fi

  wuid="$(cgr_json_string_field "$input" "work_unit_id")"
  if [[ "$wuid" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ && "$norm" =~ (^|/)evidence/units/${wuid}\.jsonl$ ]]; then
    if ! cgr_path_inside_project "$file"; then
      printf '{"permission":"deny","agent_message":"Subagent WriteGate: path outside project root"}\n'
      return 0
    fi
    return 1
  fi

  printf '{"permission":"deny","agent_message":"Subagents may not write .cursor/goal governance files without runtime safety checks."}\n'
  return 0
}

cgr_safety_response() {
  local step="$1"
  local input="$2"
  local tool cmd
  tool="$(cgr_json_string_field "$input" "tool_name")"
  cmd="$(cgr_json_string_field "$input" "command")"
  if [[ "$step" == "beforeShellExecution" || "$tool" == "Shell" || "$tool" == "Bash" ]]; then
    if cgr_destructive_shell "$cmd"; then
      printf '{"permission":"deny","agent_message":"Destructive shell blocked by cursor-goal minimal policy."}\n'
      return 0
    fi
  fi
  if [[ "$step" == "preToolUse" ]]; then
    if cgr_subagent_governance_safety "$input"; then
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
  out="$(cgr_attach_agent_message "$out" "$note")"
  cgr_apply_strict_before_submit "$step" "$out"
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
